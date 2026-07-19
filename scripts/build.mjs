#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
//  build — turns photos/YEAR/MONTH/<story>/ into a static, SEO-first site.
//
//    node scripts/build.mjs
//
//  A "story" is a folder with a story.md (frontmatter title + a summary + a
//  per-photo section per image) and its photos. The build reads allowlisted
//  EXIF, resizes to responsive AVIF/WebP/JPEG (metadata-stripped), extracts a
//  palette, makes an inline blur, then pre-renders THREE views:
//    • timeline  /                (year → month → story cards)
//    • story     /story/<slug>/   (summary + photo→text→photo… narrative)
//    • photo     /photo/<id>/     (single frame, addressable)
//  plus sitemap/robots, and bundles the qrp enhancement layer.
// ─────────────────────────────────────────────────────────────────────────

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { marked } from "marked";
import config from "../site.config.mjs";
import { readExif } from "./lib/exif.mjs";
import { dimensions, lqipDataURI, derive } from "./lib/image.mjs";
import { extractPalette } from "./lib/palette.mjs";
import { mapLimit, cpuCount, slugify } from "./lib/util.mjs";
import {
  renderIndex, renderStory, renderPhotoPage, renderSitemap, robotsTxt,
} from "./lib/html.mjs";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const { build: B } = config;
const OUT = path.resolve(ROOT, B.outDir);
const PHOTOS = path.resolve(ROOT, B.photosDir);
const IMG_RE = /\.(jpe?g|png|tiff?|webp)$/i;

// ── story.md parsing ──────────────────────────────────────────────────────
function parseFrontmatter(md) {
  if (!md.startsWith("---")) return { meta: {}, body: md };
  const end = md.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: md };
  const meta = {};
  for (const line of md.slice(3, end).split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: md.slice(end + 4) };
}

/** Split a story body into a summary + a per-photo-stem → html map. */
function parseStoryBody(body) {
  const parts = body.split(/^##[ \t]+/m);
  const summary = parts.shift().trim();
  const perPhoto = {};
  const order = [];
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const stem = (nl < 0 ? part : part.slice(0, nl)).trim();
    const text = (nl < 0 ? "" : part.slice(nl + 1)).trim();
    perPhoto[stem] = text ? marked.parse(text).trim() : null;
    order.push(stem);
  }
  return { summaryHtml: summary ? marked.parse(summary).trim() : "", perPhoto, order };
}

// ── discover stories: leaf folders containing images ──────────────────────
async function findStoryDirs() {
  const dirs = new Set();
  for (const e of await fs.readdir(PHOTOS, { withFileTypes: true, recursive: true }).catch(() => [])) {
    if (e.isFile() && IMG_RE.test(e.name)) dirs.add(e.parentPath || e.path);
  }
  return [...dirs];
}

async function processPhoto(file, ctx) {
  const stem = path.basename(file, path.extname(file));
  const imgDir = path.join(OUT, "img");

  const [exif, dim, palette, lqip] = await Promise.all([
    readExif(file, config.exifAllow),
    dimensions(file),
    extractPalette(file, B.paletteColors),
    lqipDataURI(file, B.lqip),
  ]);
  const date = exif.dateTime || ctx.fallbackDate;
  const id = slugify(`${date.slice(0, 10)}-${stem}`);

  const widths = [...new Set(B.widths.filter((w) => w <= dim.width))];
  if (!widths.length) widths.push(dim.width);

  const sizes = [];
  for (const w of widths) {
    const wantAvif = w <= B.avifMaxWidth;
    const [avif, webp] = await Promise.all([
      wantAvif ? derive(file, path.join(imgDir, `${id}-${w}.avif`), { width: w, format: "avif", quality: B.quality.avif, effort: B.effort.avif, saturate: B.saturate, srcW: dim.width }) : null,
      derive(file, path.join(imgDir, `${id}-${w}.webp`), { width: w, format: "webp", quality: B.quality.webp, effort: B.effort.webp, saturate: B.saturate, srcW: dim.width }),
    ]);
    if (webp) sizes.push({ w, h: webp.height, webp: `/img/${id}-${w}.webp`, ...(avif ? { avif: `/img/${id}-${w}.avif` } : {}) });
  }
  const fbW = widths.reduce((a, w) => (Math.abs(w - 1200) < Math.abs(a - 1200) ? w : a), widths[0]);
  await derive(file, path.join(imgDir, `${id}-${fbW}.jpg`), { width: fbW, format: "jpeg", quality: B.quality.jpeg, saturate: B.saturate, srcW: dim.width });
  await derive(file, path.join(imgDir, `${id}-full.jpg`), { width: dim.width, format: "jpeg", quality: 88, saturate: B.saturate, srcW: dim.width });

  const d = exif.display || {};
  const alt = [d.body, d.lens, d.strip].filter(Boolean).join(" · ") ||
    `Photograph — ${new Date(date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  return {
    id, url: `/photo/${id}/`, date, stem,
    width: dim.width, height: dim.height,
    palette, lqip, exif, alt,
    text: ctx.perPhoto[stem] || null,
    sizes, fallback: `/img/${id}-${fbW}.jpg`, download: `/img/${id}-full.jpg`,
  };
}

async function loadStory(dir) {
  const rel = path.relative(PHOTOS, dir).split(path.sep);
  const [year, month, slug = path.basename(dir)] = rel;
  const files = (await fs.readdir(dir)).filter((f) => IMG_RE.test(f)).map((f) => path.join(dir, f)).sort();

  let meta = {}, story = { summaryHtml: "", perPhoto: {}, order: [] };
  try {
    const parsed = parseFrontmatter(await fs.readFile(path.join(dir, "story.md"), "utf8"));
    meta = parsed.meta;
    story = parseStoryBody(parsed.body);
  } catch { /* no story.md */ }

  const fallbackDate = `${year}-${month}-15T12:00:00.000Z`;
  const photos = await mapLimit(files, cpuCount, (f) => processPhoto(f, { perPhoto: story.perPhoto, fallbackDate }));
  photos.sort((a, b) => new Date(a.date) - new Date(b.date)); // chronological within a trip

  const date = photos[0]?.date || fallbackDate;
  return {
    slug, url: `/story/${slug}/`,
    title: meta.title || slug,
    summaryHtml: story.summaryHtml,
    year: Number(year), month: `${year}-${month}`,
    date, photos,
  };
}

// compact per-photo data for the client lightbox on a page
function dataIsland(photos) {
  return JSON.stringify(photos.map((p) => ({
    id: p.id, url: p.url, alt: p.alt, date: p.date,
    width: p.sizes.at(-1).w, height: p.sizes.at(-1).h,
    sizes: p.sizes, fallback: p.fallback, download: p.download, lqip: p.lqip,
    palette: { accent: p.palette.accent, complements: p.palette.complements, dominant: p.palette.dominant },
    exif: { display: p.exif.display, details: p.exif.details },
    text: p.text,
  })));
}

async function bundleJs() {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, "src/enhance.js")],
    bundle: true, format: "esm", minify: true, target: ["es2020"], legalComments: "none", write: false,
  });
  const js = res.outputFiles[0].text;
  const hash = crypto.createHash("sha256").update(js).digest("hex").slice(0, 8);
  const name = `/assets/app-${hash}.js`;
  await fs.mkdir(path.join(OUT, "assets"), { recursive: true });
  await fs.writeFile(path.join(OUT, name), js);
  return name;
}
async function minifyCss() {
  const css = await fs.readFile(path.join(ROOT, "src/styles.css"), "utf8");
  return (await esbuild.transform(css, { loader: "css", minify: true })).code;
}
async function copyFonts() {
  const src = path.join(ROOT, "node_modules/@fontsource/fira-code/files");
  const dst = path.join(OUT, "fonts");
  await fs.mkdir(dst, { recursive: true });
  for (const w of [400, 500, 700]) {
    await fs.copyFile(path.join(src, `fira-code-latin-${w}-normal.woff2`), path.join(dst, `fira-code-${w}.woff2`));
    await fs.copyFile(path.join(src, `fira-code-latin-ext-${w}-normal.woff2`), path.join(dst, `fira-code-ext-${w}.woff2`));
  }
}

async function main() {
  const t0 = Date.now();
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  const dirs = await findStoryDirs();
  if (!dirs.length) { console.error(`no photos under ${path.relative(ROOT, PHOTOS)}/ — run ingest first.`); process.exit(1); }
  const photoCount = (await Promise.all(dirs.map(async (d) => (await fs.readdir(d)).filter((f) => IMG_RE.test(f)).length))).reduce((a, b) => a + b, 0);
  console.log(`processing ${photoCount} photo(s) in ${dirs.length} stories on ${cpuCount} cores…`);

  let stories = await Promise.all(dirs.map(loadStory));
  stories = stories.filter((s) => s.photos.length).sort((a, b) => new Date(b.date) - new Date(a.date)); // newest story first
  const allPhotos = stories.flatMap((s) => s.photos).sort((a, b) => new Date(b.date) - new Date(a.date));

  // group stories → months → years for the timeline
  const monthMap = new Map();
  for (const s of stories) (monthMap.get(s.month) || monthMap.set(s.month, []).get(s.month)).push(s);
  const months = [...monthMap.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([month, sts]) => ({ month, stories: sts }));

  const [appJs, css] = await Promise.all([bundleJs(), minifyCss()]);
  await copyFonts();

  // timeline
  await fs.writeFile(path.join(OUT, "index.html"),
    renderIndex({ months, all: allPhotos, stories, cfg: config, css, appJs, dataJson: dataIsland(allPhotos) }));

  // story pages
  for (const s of stories) {
    const dir = path.join(OUT, "story", s.slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.html"),
      renderStory({ story: s, cfg: config, css, appJs, dataJson: dataIsland(s.photos) }));
  }

  // photo pages (prev/next within the whole timeline)
  for (let i = 0; i < allPhotos.length; i++) {
    const p = allPhotos[i];
    const story = stories.find((s) => s.photos.includes(p));
    const dir = path.join(OUT, "photo", p.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.html"),
      renderPhotoPage({ p, story, prev: allPhotos[i - 1], next: allPhotos[i + 1], cfg: config, css, appJs }));
  }

  await fs.writeFile(path.join(OUT, "sitemap.xml"), renderSitemap({ stories, photos: allPhotos, cfg: config }));
  await fs.writeFile(path.join(OUT, "robots.txt"), robotsTxt(config));
  await fs.copyFile(path.join(ROOT, "LICENSE.txt"), path.join(OUT, "LICENSE.txt")).catch(() => {});
  await fs.writeFile(path.join(OUT, "404.html"),
    renderIndex({ months, all: allPhotos, stories, cfg: config, css, appJs, dataJson: dataIsland(allPhotos) }));

  console.log(`✓ built ${allPhotos.length} photos · ${stories.length} stories → ${path.relative(ROOT, OUT)}/  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
