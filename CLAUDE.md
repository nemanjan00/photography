# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Photography — a static, generated timeline photo gallery. Read before changing the pipeline.

## Commands

```sh
npm install
npm run ingest <image|dir> [more…]  # file photos by EXIF date → photos/YYYY/MM/DD/ (develops RAW)
npm run build                       # photos/ → dist/ (bundled sharp — same as Render)
PHOTO_ENGINE=imagemagick npm run build  # opt into ImageMagick instead of sharp
npm run serve                       # static-serve dist/ at http://127.0.0.1:8787
npm run dev                         # build + serve
node scripts/dev/shoot.mjs          # screenshot the served site → /tmp/shots (needs: npm i --no-save playwright-core)
```

There is **no test suite, linter, or typecheck** in this repo — verify changes
by building and eyeballing the served output / a screenshot.

## What this is

A static, timeline photo gallery generated from photos. Two Node entry points,
a pluggable image engine, and a [qrp](https://qrp.nemanja.top/) progressive-
enhancement frontend. **The photos are the data; the site is a view of them.**
The owner adds photos and pushes; Render rebuilds. No hand-written CSS, no CMS.

## Architecture (data flow)

```
originals ──ingest──▶ photos/YYYY/MM/DD/*.jpg ──build──▶ dist/
 (RAW/JPEG)           (capped "working masters",          (static HTML + responsive
                       committed to git)                    images + qrp bundle)
```

- **`scripts/ingest.mjs`** — CLI. Reads EXIF capture date, files photos into
  `photos/YYYY/MM/DD/`, converts each to a git-sane JPEG master (long edge
  ≤ `ingest.masterMaxEdge`). RAW (`.nef`…) is developed via `darktable-cli` →
  `dcraw` → **carve largest embedded JPEG** (`carveLargestJpeg`, pure JS — works
  with no RAW tool). Originals are NOT committed; RAW is gitignored.
- **`scripts/build.mjs`** — orchestrator. Per photo: `readExif` (allowlisted),
  `dimensions`, `extractPalette`, `lqipDataURI`, `derive` (responsive sizes),
  optional `<stem>.md` story. Then pre-renders HTML, bundles JS (esbuild),
  inlines minified CSS, copies fonts, writes sitemap/robots/LICENSE. Output is
  `dist/` (gitignored).
- **`scripts/lib/`** — `engine.mjs` (image back ends), `image.mjs`, `palette.mjs`,
  `exif.mjs`, `html.mjs` (all HTML/SEO strings), `util.mjs`.
- **`src/enhance.js`** — the qrp frontend (bundled). **`src/styles.css`** — the
  whole look (inlined into every page at build).
- **`site.config.mjs`** — the only hand-edited config.

## The image engine (important)

`scripts/lib/engine.mjs` exposes 5 ops (`dimensions`, `lqipBuffer`, `derive`,
`resizeMaster`, `rawColors`) over two interchangeable back ends:

- **sharp** (bundled libvips via npm) — **the default everywhere**, so the local
  build is byte-for-byte what Render produces (Render has no ImageMagick).
- **ImageMagick** (`magick`) — opt-in via `PHOTO_ENGINE=imagemagick`, kept for
  anyone who prefers it locally.

**If you add an image operation, implement it in BOTH back ends** (default sharp
must stay complete) — and keep their output equivalent.

## Conventions / invariants — do not violate

- **Never upscale.** `derive`/`resizeMaster` shrink only; the largest published
  size is capped to the master's real width. `build.mjs` filters widths ≤ master.
- **Privacy is default-deny.** Published image binaries are stripped to zero
  metadata. Only fields in `config.exifAllow` are read into the manifest / HTML /
  JSON-LD. GPS is intentionally excluded. `exif.mjs` enforces the allowlist in
  code — don't bypass it, and don't add identifying fields (serials, owner) to
  `curiosities()`.
- **SEO/perf are the point.** Content lives in static HTML (crawlable, no-JS
  readable); qrp only *enhances*. Keep aspect-ratio boxes (no CLS), `srcset`,
  inline LQIP, JSON-LD, and small JS. Don't move content rendering into JS.
- **LQIP** is a ~6–24px inline WebP data URI; it doubles as the per-photo/site
  color wash. Keep it tiny.

## Frontend (qrp) gotchas

qrp is the owner's own framework. **Before editing `src/enhance.js`, read**
`node_modules/@nemanjan00/qrp/docs/{README,SHARP-EDGES,API}.md`. Live traps here:

- The lightbox is built in a click handler → wrapped in **`scoped()`** so one
  `dispose()` tears down the render `effect()` AND the `portal`/`trapFocus`/
  `dismissable` behaviors (they auto-register teardown with the current scope).
  Don't hand-collect their undos.
- Thunk-vs-value: a `() => …` child/prop is reactive; a bare value is a snapshot.
- The page is complete static HTML without JS; enhancement must degrade
  gracefully (frame links are real `<a href>` to the photo pages).

## Effects (all in enhance.js + styles.css)

Ambient color wash (blurred copy of the active photo, YouTube-style) + drifting
palette gradients; blur-up reveal; scroll-driven color bleed (IntersectionObserver
→ qrp `state`/`effect`); device-aware parallax (mouse / gyro tilt, iOS perm);
portrait-phone landscape "sweep" (CSS, gated by `.motion-ok` + `.in-view`);
keyed lightbox with prev/next + full-res download. All motion respects
`prefers-reduced-motion` and `navigator.connection.saveData`.

## Deploy

`render.yaml` → static site, `npm ci && npm run build`, publish `dist/`.
Canonical/OG URL is `site.config.mjs → site.url` (currently
`photography.nemanja.top`). Do not push on the owner's behalf.
