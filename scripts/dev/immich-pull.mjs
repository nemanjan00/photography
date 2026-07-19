// Dev helper: download every original from an Immich shared-link into a dir.
//   node scripts/dev/immich-pull.mjs <shareKey> [destDir]
// Prints the downloaded file paths (one per line) for piping into ingest.
import fs from "node:fs/promises";
import path from "node:path";

const BASE = process.env.IMMICH_BASE || "http://10.25.0.15:2283";
const key = process.argv[2];
const dest = process.argv[3] || "/tmp/mega_dl";
if (!key) { console.error("usage: immich-pull.mjs <shareKey> [destDir]"); process.exit(1); }

await fs.mkdir(dest, { recursive: true });
const meta = await (await fetch(`${BASE}/api/shared-links/me?key=${key}`)).json();
const assets = meta.assets || [];
process.stderr.write(`share has ${assets.length} asset(s)\n`);

for (const a of assets) {
  const out = path.join(dest, a.originalFileName);
  const res = await fetch(`${BASE}/api/assets/${a.id}/original?key=${key}`);
  if (!res.ok) { process.stderr.write(`✗ ${a.originalFileName}: HTTP ${res.status}\n`); continue; }
  await fs.writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log(out);
}
