#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
//  ingest — point it at photos, it files them by EXIF capture date.
//
//    node scripts/ingest.mjs ~/Downloads/DSC*.NEF img.jpg some/dir/
//
//  For each input it:
//    • reads the EXIF capture date  → photos/YYYY/MM/DD/
//    • develops RAW (NEF…) and caps every master to a git-sane size
//    • copies (default) or moves the original
//  Falls back to file mtime when a photo has no EXIF date (and says so).
// ─────────────────────────────────────────────────────────────────────────

import fs from "node:fs/promises";
import path from "node:path";
import exifr from "exifr";
import config from "../site.config.mjs";
import { makeMaster, isRaw } from "./lib/image.mjs";
import { embedExifFromOriginal } from "./lib/embed-exif.mjs";
import { pad } from "./lib/util.mjs";

const IMAGE_RE = /\.(jpe?g|png|tiff?|heic|heif|webp|nef|cr2|cr3|arw|dng|raf|rw2|orf)$/i;

async function expand(paths) {
  const out = [];
  for (const p of paths) {
    let st;
    try { st = await fs.stat(p); } catch { console.warn(`⚠  skip (not found): ${p}`); continue; }
    if (st.isDirectory()) {
      for (const e of await fs.readdir(p, { recursive: true })) {
        const full = path.join(p, e);
        if (IMAGE_RE.test(full) && (await fs.stat(full)).isFile()) out.push(full);
      }
    } else if (IMAGE_RE.test(p)) {
      out.push(p);
    } else {
      console.warn(`⚠  skip (not an image): ${p}`);
    }
  }
  return out;
}

async function captureDate(file) {
  try {
    const d = await exifr.parse(file, ["DateTimeOriginal", "CreateDate", "DateTimeDigitized"]);
    const raw = d?.DateTimeOriginal || d?.CreateDate || d?.DateTimeDigitized;
    if (raw) return { date: new Date(raw), source: "exif" };
  } catch { /* fall through */ }
  const st = await fs.stat(file);
  return { date: st.mtime, source: "mtime" };
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

async function main() {
  const inputs = process.argv.slice(2);
  if (!inputs.length) {
    console.error("usage: node scripts/ingest.mjs <image|dir> [more…]");
    process.exit(1);
  }
  const files = await expand(inputs);
  if (!files.length) { console.error("no images found."); process.exit(1); }

  const root = path.resolve(config.build.photosDir);
  let ok = 0, mtimeCount = 0;

  for (const file of files) {
    try {
      const { date, source } = await captureDate(file);
      if (source === "mtime") mtimeCount++;
      const dir = path.join(root, String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate()));
      await fs.mkdir(dir, { recursive: true });

      // masters are always JPEG (universal, git-friendly); RAW is developed.
      const stem = path.basename(file, path.extname(file));
      const target = await uniqueTarget(dir, `${stem}.jpg`);

      const { developer } = await makeMaster(file, target, config.ingest);

      // Embed the allowlisted EXIF from the ORIGINAL into the master JPG, so the
      // committed JPG is self-contained. A master carved from a RAW's embedded
      // preview carries no EXIF otherwise. Privacy-safe: allowlist only, no GPS.
      await embedExifFromOriginal(file, target, config.exifAllow).catch(() => {});

      if (config.ingest.move && !isRaw(file)) {
        // never delete a RAW original — it's the negative. only move non-RAW.
        await fs.rm(file, { force: true });
      }

      const rel = path.relative(process.cwd(), target);
      const tag = source === "mtime" ? " (date from mtime — no EXIF!)" : "";
      console.log(`✓ ${path.basename(file)} → ${rel}  [${developer}]${tag}`);
      ok++;
    } catch (err) {
      console.error(`✗ ${path.basename(file)}: ${err.message}`);
    }
  }

  console.log(`\ningested ${ok}/${files.length} → ${path.relative(process.cwd(), root)}/YYYY/MM/DD/`);
  if (mtimeCount) console.log(`⚠  ${mtimeCount} had no EXIF date — filed by file mtime; double-check those.`);
  console.log(`next: git add photos && git commit && push  (Render rebuilds on push)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
