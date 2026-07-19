import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFileAsync = promisify(execFile);

/** Run `magick` with args; returns { stdout, stderr }. Throws on nonzero. */
export async function magick(args, opts = {}) {
  return execFileAsync("magick", args, { maxBuffer: 64 * 1024 * 1024, ...opts });
}

/** Run any binary; returns stdout. Throws on nonzero unless allowFail. */
export async function run(cmd, args, { allowFail = false, ...opts } = {}) {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      maxBuffer: 128 * 1024 * 1024,
      ...opts,
    });
    return stdout;
  } catch (err) {
    if (allowFail) return null;
    throw err;
  }
}

/** Is a binary on PATH? */
export async function has(cmd) {
  return (await run("sh", ["-c", `command -v ${cmd}`], { allowFail: true })) != null;
}

/** Bounded-concurrency map. Keeps all CPU cores busy without forking a storm. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

export const cpuCount = Math.max(1, os.cpus().length);

/** URL/file-safe slug. */
export function slugify(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "photo";
}

/** Escape text for safe HTML text/attribute context. */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Zero-pad a number to width. */
export const pad = (n, w = 2) => String(n).padStart(w, "0");
