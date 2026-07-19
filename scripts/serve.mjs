#!/usr/bin/env node
// Tiny zero-dependency static server for local preview of dist/.
// Mirrors how a static host resolves things: /photo/x/ → /photo/x/index.html,
// unknown paths → 404.html. Not for production — Render serves dist/ directly.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..", "dist");
const PORT = process.env.PORT || 8787;
const HOST = process.env.HOST || "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".webp": "image/webp", ".avif": "image/avif", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".png": "image/png", ".woff2": "font/woff2",
  ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml",
};

function resolve(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  let fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT)) return null; // no traversal
  try {
    if (fs.statSync(fp).isDirectory()) fp = path.join(fp, "index.html");
    return fs.existsSync(fp) ? fp : null;
  } catch { return null; }
}

http.createServer((req, res) => {
  let fp = resolve(req.url);
  let code = 200;
  if (!fp) { fp = path.join(ROOT, "404.html"); code = fs.existsSync(fp) ? 404 : 404; }
  if (!fs.existsSync(fp)) { res.writeHead(404).end("404"); return; }
  const ext = path.extname(fp);
  const immutable = /\/(assets|img|fonts)\//.test(req.url);
  res.writeHead(code, {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  fs.createReadStream(fp).pipe(res);
}).listen(PORT, HOST, () => {
  console.log(`serving dist/ → http://${HOST}:${PORT}`);
});
