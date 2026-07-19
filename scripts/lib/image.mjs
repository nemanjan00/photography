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
  const carved = await carveLargestJpeg(input);
  if (carved) {
    const tmp = outPath + ".carve.jpg"; // temp file: works for both engines
    await fs.writeFile(tmp, carved);
    await eng.resizeMaster(tmp, outPath, { maxEdge, quality });
    await fs.rm(tmp, { force: true });
    return { outPath, developer: "embedded-preview" };
  }
  throw new Error(
    `Cannot develop RAW "${path.basename(input)}": no darktable-cli/dcraw and no embedded JPEG preview found. ` +
      `Install darktable-cli or dcraw, or export a JPEG/TIFF first.`
  );
}

/** Scan a file for JPEG segments (SOI…EOI) and return the largest as a Buffer. */
export async function carveLargestJpeg(file) {
  const buf = await fs.readFile(file);
  let best = null, bestLen = 0;
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8) {
      for (let j = i + 2; j < buf.length - 1; j++) {
        if (buf[j] === 0xff && buf[j + 1] === 0xd9) {
          const len = j + 2 - i;
          if (len > bestLen) { bestLen = len; best = buf.subarray(i, j + 2); }
          i = j + 1;
          break;
        }
      }
    }
  }
  return bestLen > 4096 ? best : null; // ignore tiny thumbnails
}
