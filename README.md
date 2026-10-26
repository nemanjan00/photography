# Photography

A timeline photo gallery that you feed with photos and nothing else.

Drop photos in, push, done. A build step reads each photo's EXIF, resizes it
into responsive AVIF/WebP, extracts its colors, strips its private metadata,
and pre-renders static HTML — then [qrp](https://qrp.nemanja.top/) adds a
lightbox, a blur-up reveal, scroll-driven color, and device-aware motion on
top. **You never touch the site and never write a line of CSS.**

- **Timeline first** — organized by capture date, newest at the top.
- **Color splashed everywhere** — each photo's own colors bleed around it
  (YouTube "ambient mode" style) and wash the whole page as you scroll.
- **Technical photography** — the full shooting data is content: `ƒ/8 · 1/3200s
  · ISO 6400 · 56mm`, plus body/lens and the weird extras (metering, program,
  light value, flash…).
- **Fast + SEO-first** — static HTML, `srcset`/AVIF, inline LQIP, aspect-ratio
  boxes (no layout shift), JSON-LD, sitemap. Tiny JS (qrp is ~4.6–18 KB).
- **Private by default** — published images are stripped to *zero* metadata;
  only an explicit EXIF allowlist is rendered. GPS is never published.

## Workflow

```sh
npm install
npm run ingest -- --story bled --title "Bled, Slovenia" ~/Pictures/bled/
$EDITOR photos/2022/04/bled/story.md   # write the story
git add photos && git commit -m "new story"
git push                          # Render rebuilds and deploys
```

Local preview:

```sh
npm run dev        # build + serve at http://127.0.0.1:8787
# or separately:
npm run build
npm run serve
```

## The two tools

### `ingest` — get photos in

```sh
npm run ingest -- --story <slug> [--title "Title"] <image|dir> [more…]
```

Files the photos into a **story** folder, `photos/YEAR/MONTH/<slug>/` (year and
month from the earliest EXIF capture date; an existing `<slug>` folder is
reused, so you can add photos to a story later). Each file is converted to a **capped, git-sane working master** (JPEG, long edge ≤ 4096 px
by default). RAW is developed on the way in:

- `darktable-cli` or `dcraw` if installed (best), otherwise
- the **full-res JPEG preview carved straight out of the RAW bytes** — so
  Nikon `.nef` import works with *no* RAW tool at all (it's your in-camera
  render, which is usually what you want).

Allowlisted EXIF is embedded into the master, and a `story.md` is scaffolded
(title + a `## <stem>` section per photo) for you to write into.

Your true originals stay wherever they already are; only the capped master is
committed, so the repo never balloons.

### `build` — turn photos into the site

```sh
npm run build     # → dist/
```

For every master it: reads allowlisted EXIF, measures it, extracts a palette
(+ complements), makes a ~6px inline blur, and emits responsive AVIF/WebP/JPEG
(metadata-stripped). Then it pre-renders the timeline, a page per story and a
page per photo with meta/OG/JSON-LD, writes `sitemap.xml` (with images) and
`robots.txt`, and bundles the qrp enhancement layer.

## Configuration

Everything you'd tune lives in [`site.config.mjs`](site.config.mjs): site
title/URL, responsive widths, formats & quality, LQIP size, palette count,
saturation, ingest cap, and the **EXIF allowlist**.

**Saturation** — `build.saturate` is `100` (preserve your look). Set it higher
to let the pipeline punch color for you (e.g. `128` = +28%).

**Privacy** — `exifAllow` is a *default-deny* allowlist. Only listed fields are
ever read into the manifest, rendered, or published. GPS is deliberately
absent; add `"gps"` only if you want location published.

## Stories

Every folder under `photos/YEAR/MONTH/` is a story: its photos plus a
`story.md`. On desktop a story is a blog (photo → text → photo…); on a phone it
opens as a full-screen slideshow.

```markdown
---
title: Bled, Slovenia
location: Bled, Slovenia            # optional → JSON-LD Place, photo alt fallback
description: Lake, island, castle.  # optional meta/OG description override
cover: DSC_1234                     # optional (default: first photo) → story-page cover, share image, slideshow title card
---
**Bled** — the summary. This part shows on the timeline card.

<!-- more -->

Anything below the marker shows only on the story page (and as the
slideshow's opening text slides).

## DSC_1234
alt: A church spire lit gold against a pale winter sky

Text shown after this photo (one slideshow slide per paragraph).

## DSC_1240
alt: …
```

- The order of the `## <stem>` sections **is** the story order — move a
  section to move its photo. Photos without a section follow, by time.
- `alt:` is the photo's description for search and screen readers (alt text,
  photo-page title, JSON-LD). It is never shown as story text.
- A YouTube URL on its own line embeds the video as part of the story.

## Deploy (Render)

[`render.yaml`](render.yaml) defines a static site: `npm ci && npm run build`,
publish `dist/`, with long-cache headers on fingerprinted assets. Point Render
at the repo and it builds on every push.

The build has **no system dependencies**: image processing uses
[`sharp`](https://sharp.pixelplumbing.com/) (bundled libvips binary via npm) by
default, so the local build matches Render exactly. Prefer ImageMagick locally?
`PHOTO_ENGINE=imagemagick npm run build`.

## License

[MIT](LICENSE.txt) © Nemanja Nedeljkovic. Built with
[qrp](https://qrp.nemanja.top/) (MIT).
