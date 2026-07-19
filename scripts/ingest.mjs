#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
//  ingest — point it at photos, it files them under a STORY (trip).
//
//    node scripts/ingest.mjs --story bled --title "Bled, Slovenia" ~/pics/*.NEF
//
//  Photos land in  photos/YEAR/MONTH/<story>/  (YEAR/MONTH from EXIF capture
//  date; an existing <story> folder is reused wherever it lives). RAW (NEF…)
//  is developed, every master is capped git-sane, and allowlisted EXIF is
//  embedded into the JPG so it is self-contained. A story.md is scaffolded
//  (title + summary + a per-photo section per image) for you to write into.
// ─────────────────────────────────────────────────────────────────────────

import fs from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import config from "../site.config.mjs";
import { makeMaster, isRaw } from "./lib/image.mjs";
import { embedExifFromOriginal } from "./lib/embed-exif.mjs";
import { pad, slugify } from "./lib/util.mjs";

const IMAGE_RE = /\.(jpe?g|png|tiff?|heic|heif|webp|nef|cr2|cr3|arw|dng|raf|rw2|orf)$/i;

function parseArgs(argv) {
  const files = []; let story = null, title = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--story") story = argv[++i];
    else if (a === "--title") title = argv[++i];
    else files.push(a);
  }
  return { story, title, files };
}

async function expand(paths) {
  const out = [];
  for (const p of paths) {
    let st; try { st = await fs.stat(p); } catch { console.warn(`⚠  skip (not found): ${p}`); continue; }
    if (st.isDirectory()) {
      for (const e of await fs.readdir(p, { recursive: true })) {
        const full = path.join(p, e);
        if (IMAGE_RE.test(full) && (await fs.stat(full)).isFile()) out.push(full);
      }
    } else if (IMAGE_RE.test(p)) out.push(p);
    else console.warn(`⚠  skip (not an image): ${p}`);
  }
  return out;
}

async function captureDate(file) {
  try {
    const d = await exifr.parse(file, ["DateTimeOriginal", "CreateDate", "DateTimeDigitized"]);
    const raw = d?.DateTimeOriginal || d?.CreateDate || d?.DateTimeDigitized;
    if (raw) return new Date(raw);
  } catch { /* fall through */ }
  return (await fs.stat(file)).mtime;
}

async function findExistingStoryDir(root, slug) {
  for (const e of await fs.readdir(root, { recursive: true, withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && e.name === slug) return path.join(e.parentPath || e.path, e.name);
  }
  return null;
}

async function uniqueTarget(dir, base) {
  let name = base, i = 1;
  while (true) {
    try { await fs.access(path.join(dir, name)); }
    catch { return path.join(dir, name); }
    const ext = path.extname(base), stem = base.slice(0, -ext.length || undefined);
    name = `${stem}-${i++}${ext}`;
  }
}

async function scaffoldStory(dir, title, stems) {
  const md = path.join(dir, "story.md");
  let existing = "";
  try { existing = await fs.readFile(md, "utf8"); } catch { /* new */ }
  if (!existing) {
    const head = `---\ntitle: ${title}\n---\n\n_Write the trip summary here._\n\n`;
    existing = head + stems.map((s) => `## ${s}\n`).join("\n");
    await fs.writeFile(md, existing);
    return;
  }
  // append sections for any new stems not already present
  const missing = stems.filter((s) => !new RegExp(`^##\\s+${s}\\b`, "m").test(existing));
  if (missing.length) await fs.appendFile(md, "\n" + missing.map((s) => `## ${s}\n`).join("\n"));
}

async function main() {
  const { story, title, files: inputs } = parseArgs(process.argv.slice(2));
  if (!story || !inputs.length) {
    console.error('usage: node scripts/ingest.mjs --story <slug> [--title "Title"] <image|dir> [more…]');
    process.exit(1);
  }
  const slug = slugify(story);
  const files = await expand(inputs);
  if (!files.length) { console.error("no images found."); process.exit(1); }

  const root = path.resolve(config.build.photosDir);
  // decide the story folder: reuse an existing one, else YEAR/MONTH from the
  // earliest capture date in this batch.
  let dir = await findExistingStoryDir(root, slug);
  if (!dir) {
    const dates = await Promise.all(files.map(captureDate));
    const earliest = new Date(Math.min(...dates.map((d) => +d)));
    dir = path.join(root, String(earliest.getFullYear()), pad(earliest.getMonth() + 1), slug);
  }
  await fs.mkdir(dir, { recursive: true });

  const stems = [], warnings = [];
  for (const file of files) {
    try {
      const stem = path.basename(file, path.extname(file));
      const target = await uniqueTarget(dir, `${stem}.jpg`);
      const { developer } = await makeMaster(file, target, config.ingest);
      await embedExifFromOriginal(file, target, config.exifAllow).catch(() => {});
      if (config.ingest.move && !isRaw(file)) await fs.rm(file, { force: true });
      stems.push(path.basename(target, ".jpg"));
      console.log(`✓ ${path.basename(file)} → ${path.relative(process.cwd(), target)}  [${developer}]`);
    } catch (err) { warnings.push(`✗ ${path.basename(file)}: ${err.message}`); }
  }
  warnings.forEach((w) => console.error(w));

  await scaffoldStory(dir, title || story, stems);
  console.log(`\ningested ${stems.length}/${files.length} → ${path.relative(process.cwd(), dir)}/`);
  console.log(`edit ${path.relative(process.cwd(), path.join(dir, "story.md"))} to add the story, then commit & push.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
