#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
//  build — turns photos/ into a static, SEO-first, PageSpeed-friendly site.
//
//    node scripts/build.mjs
//
//  For every master it: reads allowlisted EXIF, measures it, extracts a
//  palette (+complements), makes a 6px inline blur, and emits responsive
//  AVIF/WebP/JPEG (metadata-stripped). Then it pre-renders static HTML for
//  the timeline and every photo, bundles the qrp enhancement layer, and
//  writes sitemap/robots. Render just serves dist/.
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
import { mapLimit, cpuCount, slugify, esc } from "./lib/util.mjs";
import {
  renderIndex, renderPhotoPage, renderSitemap, robotsTxt,
} from "./lib/html.mjs";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const { build: B, site } = config;
const OUT = path.resolve(ROOT, B.outDir);
const PHOTOS = path.resolve(ROOT, B.photosDir);
const MASTER_RE = /\.(jpe?g|png|tiff?|webp)$/i;

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => [])) {
    const full = path.join(e.parentPath || e.path, e.name);
    if (e.isFile() && MASTER_RE.test(e.name)) out.push(full);
  }
  return out;
}

function dateFromPath(rel) {
  const m = rel.match(/(\d{4})[/\\](\d{2})[/\\](\d{2})[/\\]/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

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

async function processPhoto(file) {
  const rel = path.relative(PHOTOS, file);
  const stem = path.basename(file, path.extname(file));
  const dayKey = dateFromPath(rel + path.sep) || new Date().toISOString().slice(0, 10);
  const id = slugify(`${dayKey}-${stem}`);
  const imgDir = path.join(OUT, "img");

  const [exif, dim, palette, lqip] = await Promise.all([
    readExif(file, config.exifAllow),
    dimensions(file),
    extractPalette(file, B.paletteColors),
    lqipDataURI(file, B.lqip),
  ]);

  const date = exif.dateTime || `${dayKey}T12:00:00.000Z`;

  // responsive sizes, capped to the master's real width (never upscale)
  const widths = [...new Set(B.widths.filter((w) => w <= dim.width))];
  if (!widths.length) widths.push(dim.width);

  const sizes = [];
  for (const w of widths) {
    const [avif, webp] = await Promise.all([
      derive(file, path.join(imgDir, `${id}-${w}.avif`), { width: w, format: "avif", quality: B.quality.avif, saturate: B.saturate, srcW: dim.width }),
      derive(file, path.join(imgDir, `${id}-${w}.webp`), { width: w, format: "webp", quality: B.quality.webp, saturate: B.saturate, srcW: dim.width }),
    ]);
    if (avif && webp)
      sizes.push({ w, h: avif.height, avif: `/img/${id}-${w}.avif`, webp: `/img/${id}-${w}.webp` });
  }

  // a universal JPEG fallback (mid) + a full-res JPEG for the download button
  const fbW = widths.reduce((a, w) => (Math.abs(w - 1200) < Math.abs(a - 1200) ? w : a), widths[0]);
  await derive(file, path.join(imgDir, `${id}-${fbW}.jpg`), { width: fbW, format: "jpeg", quality: B.quality.jpeg, saturate: B.saturate, srcW: dim.width });
  await derive(file, path.join(imgDir, `${id}-full.jpg`), { width: dim.width, format: "jpeg", quality: 88, saturate: B.saturate, srcW: dim.width });

  // optional markdown story sibling: <stem>.md
  let story = null, meta = {};
  try {
    const md = await fs.readFile(path.join(path.dirname(file), `${stem}.md`), "utf8");
    const parsed = parseFrontmatter(md);
    meta = parsed.meta;
    story = marked.parse(parsed.body).trim();
  } catch { /* no story, fine */ }

  const d = exif.display || {};
  const alt =
    meta.alt || meta.title ||
    [d.body, d.lens, d.strip].filter(Boolean).join(" · ") ||
    `Photograph — ${new Date(date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  return {
    id, url: `/photo/${id}/`, date, dayKey,
    width: dim.width, height: dim.height,
    palette, lqip, exif, story, alt,
    sizes,
    fallback: `/img/${id}-${fbW}.jpg`,
    download: `/img/${id}-full.jpg`,
  };
}

// A compact copy for the client-side lightbox (only what it needs).
function dataIsland(all) {
  return JSON.stringify(
    all.map((p) => ({
      id: p.id, url: p.url, alt: p.alt, date: p.date,
      width: p.sizes.at(-1).w, height: p.sizes.at(-1).h,
      sizes: p.sizes, fallback: p.fallback, download: p.download, lqip: p.lqip,
      palette: { accent: p.palette.accent, complements: p.palette.complements, dominant: p.palette.dominant },
      exif: { display: p.exif.display, details: p.exif.details },
      story: p.story,
    }))
  );
}

async function bundleJs() {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, "src/enhance.js")],
    bundle: true, format: "esm", minify: true, target: ["es2020"],
    legalComments: "none", write: false,
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
  const out = await esbuild.transform(css, { loader: "css", minify: true });
  return out.code;
}

async function copyFonts() {
  const src = path.join(ROOT, "node_modules/@fontsource/fira-code/files");
  const dst = path.join(OUT, "fonts");
  await fs.mkdir(dst, { recursive: true });
  for (const w of [400, 500, 700]) {
    await fs.copyFile(
      path.join(src, `fira-code-latin-${w}-normal.woff2`),
      path.join(dst, `fira-code-${w}.woff2`)
    );
  }
}

async function main() {
  const t0 = Date.now();
  await fs.rm(OUT, { recursive: true, force: true });
  await fs.mkdir(OUT, { recursive: true });

  const files = (await walk(PHOTOS)).sort();
  if (!files.length) {
    console.error(`no photos under ${path.relative(ROOT, PHOTOS)}/ — run ingest first.`);
    process.exit(1);
  }
  console.log(`processing ${files.length} photo(s) on ${cpuCount} cores…`);

  const all = (await mapLimit(files, cpuCount, processPhoto))
    .sort((a, b) => new Date(b.date) - new Date(a.date)); // newest first

  // group into day sections (newest day first)
  const dayMap = new Map();
  for (const p of all) (dayMap.get(p.dayKey) || dayMap.set(p.dayKey, []).get(p.dayKey)).push(p);
  const days = [...dayMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, photos]) => ({ date, photos }));

  const [appJs, css] = await Promise.all([bundleJs(), minifyCss()]);
  await copyFonts();

  const dataJson = dataIsland(all);
  await fs.writeFile(path.join(OUT, "index.html"), renderIndex({ days, all, cfg: config, css, appJs, dataJson }));

  for (let i = 0; i < all.length; i++) {
    const p = all[i];
    const dir = path.join(OUT, "photo", p.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "index.html"),
      renderPhotoPage({ p, prev: all[i - 1], next: all[i + 1], cfg: config, css, appJs }));
  }

  await fs.writeFile(path.join(OUT, "sitemap.xml"), renderSitemap(all, config));
  await fs.writeFile(path.join(OUT, "robots.txt"), robotsTxt(config));
  await fs.copyFile(path.join(ROOT, "LICENSE.txt"), path.join(OUT, "LICENSE.txt")).catch(() => {});
  // SPA-ish fallback for deep photo routes if the host wants one
  await fs.writeFile(path.join(OUT, "404.html"), renderIndex({ days, all, cfg: config, css, appJs, dataJson }));

  const kb = (await du(OUT)) / 1024;
  console.log(`✓ built ${all.length} photos → ${path.relative(ROOT, OUT)}/  (${(Date.now() - t0) / 1000}s, ${kb.toFixed(0)} KB)`);
}

async function du(dir) {
  let total = 0;
  for (const e of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (e.isFile()) total += (await fs.stat(path.join(e.parentPath || e.path, e.name))).size;
  }
  return total;
}

main().catch((e) => { console.error(e); process.exit(1); });
