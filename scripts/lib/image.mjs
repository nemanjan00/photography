import { run, has } from "./util.mjs";
import { engine } from "./engine.mjs";
import fs from "node:fs/promises";
import path from "node:path";

/** Master image dimensions (orientation-corrected). */
export async function dimensions(file) {
  return (await engine()).dimensions(file);
}

/**
 * Tiny inline blur placeholder (LQIP): a ~24px-longest-edge WebP, base64'd
 * into a data URI. A few dozen bytes — paints on the first byte; CSS blurs
 * it up into a colorful smear of the real photo.
 */
export async function lqipDataURI(file, opts) {
  const buf = await (await engine()).lqipBuffer(file, opts);
  return `data:image/webp;base64,${buf.toString("base64")}`;
}

/** Emit one responsive size in one format. Never upscales past `srcW`. */
export async function derive(file, outPath, opts) {
  return (await engine()).derive(file, outPath, opts);
}

// ── Ingest-side: build a git-sane working master ──────────────────────────

/** True if the file is a RAW we must develop (Nikon NEF & friends). */
export function isRaw(file) {
  return /\.(nef|cr2|cr3|arw|dng|raf|rw2|orf)$/i.test(file);
}

/**
 * Produce a capped, high-quality JPEG working master from any input,
 * developing RAW when needed. Returns { outPath, developer }.
 *
 * RAW develop priority (all local-only; not needed for JPEG/HEIC input):
 *   1. darktable-cli  — proper demosaic + color (best)
 *   2. dcraw | engine — classic pipeline
 *   3. embedded full-res JPEG preview carved from the RAW bytes — fallback
 *      (works with NO raw tool; Nikon embeds a full-size render)
 */
export async function makeMaster(input, outPath, { maxEdge = 4096, quality = 92 } = {}) {
  const eng = await engine();
  await fs.mkdir(path.dirname(outPath), { recursive: true });

  if (!isRaw(input)) {
    await eng.resizeMaster(input, outPath, { maxEdge, quality });
    return { outPath, developer: eng.name };
  }

  if (await has("darktable-cli")) {
    const tif = outPath + ".dt.tif";
    await run("darktable-cli", [input, tif, "--core", "--conf", "plugins/imageio/format/tiff/bpp=8"]);
    await eng.resizeMaster(tif, outPath, { maxEdge, quality });
    await fs.rm(tif, { force: true });
    return { outPath, developer: "darktable-cli" };
  }
  if (await has("dcraw")) {
    const ppm = await run("dcraw", ["-c", "-w", "-6", input], { encoding: "buffer" });
    const tmp = outPath + ".ppm";
    await fs.writeFile(tmp, ppm);
    await eng.resizeMaster(tmp, outPath, { maxEdge, quality });
    await fs.rm(tmp, { force: true });
    return { outPath, developer: "dcraw" };
  }
  // try embedded previews largest-first, validating each actually decodes
  const candidates = await carveJpegs(input);
  for (const buf of candidates) {
    const tmp = outPath + ".carve.jpg"; // temp file: works for both engines
    try {
      await fs.writeFile(tmp, buf);
      await eng.resizeMaster(tmp, outPath, { maxEdge, quality });
      await fs.rm(tmp, { force: true });
      return { outPath, developer: "embedded-preview" };
    } catch {
      await fs.rm(tmp, { force: true });
    }
  }
  throw new Error(
    `Cannot develop RAW "${path.basename(input)}": no darktable-cli/dcraw and no decodable embedded JPEG preview. ` +
      `Install darktable-cli or dcraw, or export a JPEG/TIFF first.`
  );
}

/**
 * Carve embedded JPEG images out of a container (NEF/RAW) by walking JPEG
 * markers properly: APPn/other segments are skipped by their length, and the
 * SOS entropy stream is scanned to the *real* EOI — so a nested EXIF thumbnail
 * inside a preview never truncates it. Returns candidate buffers, largest-first.
 */
export async function carveJpegs(file) {
  const buf = await fs.readFile(file);
  const out = [];
  let i = 0;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff || buf[i + 1] !== 0xd8) { i++; continue; } // seek SOI
    const start = i;
    let j = i + 2;
    let end = -1;
    while (j < buf.length - 1) {
      if (buf[j] !== 0xff) { j++; continue; }
      const m = buf[j + 1];
      if (m === 0xff || m === 0x00) { j++; continue; }               // fill / stuffed
      if (m === 0xd9) { end = j + 2; break; }                        // EOI
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { j += 2; continue; } // standalone
      const len = (buf[j + 2] << 8) | buf[j + 3];                    // segment w/ length
      if (len < 2) { j += 2; continue; }
      j += 2 + len;
      if (m === 0xda) {                                              // SOS → scan entropy
        while (j < buf.length - 1) {
          if (buf[j] === 0xff && buf[j + 1] !== 0x00 && !(buf[j + 1] >= 0xd0 && buf[j + 1] <= 0xd7)) break;
          j++;
        }
      }
    }
    if (end > 0) { out.push(buf.subarray(start, end)); i = end; } else i = start + 2;
  }
  return out.filter((b) => b.length > 8192).sort((a, b) => b.length - a.length);
}
