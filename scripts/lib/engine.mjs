// ─────────────────────────────────────────────────────────────────────────
//  Pluggable image engine. Auto-detects at runtime:
//    • ImageMagick (`magick`) when the binary is on PATH  (local / this box)
//    • sharp (bundled libvips via npm)                      (Render / anywhere)
//  Both back ends implement the same 5 ops and produce equivalent output, so
//  the build runs identically whether or not the host has ImageMagick.
// ─────────────────────────────────────────────────────────────────────────

import fs from "node:fs/promises";
import path from "node:path";
import { magick } from "./util.mjs";

let _engine = null;
export async function engine() {
  if (_engine) return _engine;
  // sharp (bundled libvips) is the default EVERYWHERE — local build == Render
  // build, no divergence. Opt into ImageMagick with PHOTO_ENGINE=imagemagick.
  _engine = process.env.PHOTO_ENGINE === "imagemagick" ? magickEngine : await sharpEngine();
  return _engine;
}
export async function engineName() {
  return (await engine()).name;
}

// ── ImageMagick back end ──────────────────────────────────────────────────
const magickEngine = {
  name: "imagemagick",

  async dimensions(file) {
    const { stdout } = await magick([file + "[0]", "-auto-orient", "-format", "%w %h", "info:"]);
    const [width, height] = stdout.trim().split(/\s+/).map(Number);
    return { width, height };
  },

  async lqipBuffer(file, { maxEdge = 24, quality = 40 } = {}) {
    const { stdout } = await magick(
      [file + "[0]", "-auto-orient", "-strip", "-resize", `${maxEdge}x${maxEdge}`, "-quality", String(quality), "webp:-"],
      { encoding: "buffer" }
    );
    return stdout;
  },

  async derive(file, outPath, { width, format, quality, saturate = 100, srcW }) {
    if (srcW && width > srcW) return null;
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    const args = [file + "[0]", "-auto-orient", "-strip", "-resize", `${width}x`, "-filter", "Lanczos"];
    if (saturate !== 100) args.push("-modulate", `100,${saturate},100`);
    args.push("-quality", String(quality), `${format}:${outPath}`);
    await magick(args);
    const { stdout } = await magick([outPath, "-format", "%w %h %B", "info:"]);
    const [w, h, bytes] = stdout.trim().split(/\s+/).map(Number);
    return { width: w, height: h, bytes, format, path: outPath };
  },

  async resizeMaster(input, outPath, { maxEdge = 4096, quality = 92, saturate = 100 } = {}) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    const args = [input + "[0]", "-auto-orient", "-resize", `${maxEdge}x${maxEdge}>`];
    if (saturate !== 100) args.push("-modulate", `100,${saturate},100`);
    args.push("-quality", String(quality), outPath);
    await magick(args);
  },

  async rawColors(file, n) {
    const { stdout } = await magick([
      file, "-strip", "-resize", "200x200", "-alpha", "off", "-depth", "8",
      "-colors", String(Math.max(n * 3, 12)), "-format", "%c", "histogram:info:-",
    ]);
    const out = [];
    const re = /(\d+):\s*\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g;
    let m;
    while ((m = re.exec(stdout))) out.push({ count: +m[1], r: +m[2], g: +m[3], b: +m[4] });
    return out;
  },
};

// ── sharp back end ────────────────────────────────────────────────────────
async function sharpEngine() {
  const sharp = (await import("sharp")).default;
  sharp.cache(false);

  const mod = (s, pipe) => (s !== 100 ? pipe.modulate({ saturation: s / 100 }) : pipe);

  return {
    name: "sharp",

    async dimensions(file) {
      const m = await sharp(file).metadata();
      const swap = m.orientation >= 5; // 90°/270° rotations swap w/h
      return { width: swap ? m.height : m.width, height: swap ? m.width : m.height };
    },

    async lqipBuffer(file, { maxEdge = 24, quality = 40 } = {}) {
      return sharp(file).rotate()
        .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
        .webp({ quality }).toBuffer();
    },

    async derive(file, outPath, { width, format, quality, saturate = 100, srcW }) {
      if (srcW && width > srcW) return null;
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      let pipe = sharp(file).rotate().resize({ width, withoutEnlargement: true });
      pipe = mod(saturate, pipe);
      const opts = { quality };
      const info = await pipe.toFormat(format === "jpeg" ? "jpeg" : format, opts).toFile(outPath);
      return { width: info.width, height: info.height, bytes: info.size, format, path: outPath };
    },

    async resizeMaster(input, outPath, { maxEdge = 4096, quality = 92, saturate = 100 } = {}) {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      let pipe = sharp(input).rotate().resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true });
      pipe = mod(saturate, pipe);
      await pipe.jpeg({ quality, mozjpeg: true }).toFile(outPath);
    },

    async rawColors(file, n) {
      const { data, info } = await sharp(file).rotate()
        .resize(200, 200, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
      const ch = info.channels;
      const buckets = new Map(); // quantize to 5 bits/channel, keep running average
      for (let i = 0; i < data.length; i += ch) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
        const e = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
        e.r += r; e.g += g; e.b += b; e.count++;
        buckets.set(key, e);
      }
      return [...buckets.values()]
        .sort((a, z) => z.count - a.count)
        .slice(0, Math.max(n * 3, 12))
        .map((e) => ({ r: e.r / e.count, g: e.g / e.count, b: e.b / e.count, count: e.count }));
    },
  };
}
