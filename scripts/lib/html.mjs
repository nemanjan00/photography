import { esc } from "./util.mjs";

const SIZES_GRID =
  "(max-width:640px) 94vw, (max-width:1100px) 47vw, (max-width:1600px) 47vw, 33vw";
const SIZES_HERO = "min(96vw, 1800px)";

// ── Fragments ─────────────────────────────────────────────────────────────

function srcset(sizes, fmt) {
  return sizes.map((s) => `${s[fmt]} ${s.w}w`).join(", ");
}

export function pictureTag(p, { sizes = SIZES_GRID, eager = false } = {}) {
  const big = p.sizes[p.sizes.length - 1];
  const attrs = eager
    ? 'loading="eager" fetchpriority="high" decoding="async"'
    : 'loading="lazy" decoding="async"';
  return `<picture>
      <source type="image/avif" srcset="${srcset(p.sizes, "avif")}" sizes="${sizes}">
      <source type="image/webp" srcset="${srcset(p.sizes, "webp")}" sizes="${sizes}">
      <img src="${p.fallback}" width="${big.w}" height="${big.h}" alt="${esc(p.alt)}" ${attrs}>
    </picture>`;
}

function exifStrip(p) {
  const d = p.exif.display || {};
  if (!d.strip) return "";
  // bold the aperture — the number photographers read first
  const strip = d.strip.replace(d.aperture || "", d.aperture ? `<b>${esc(d.aperture)}</b>` : "");
  const gear = [d.body, d.lens].filter(Boolean).join(" · ");
  return `<span class="exif-strip">${strip}</span>${gear ? `<span class="gear">${esc(gear)}</span>` : ""}`;
}

function paletteVars(p) {
  const c = p.palette.dominant;
  return [
    `--ar:${p.width}/${p.height}`,
    `--lqip:url('${p.lqip}')`,
    `--accent:${p.palette.accent}`,
    `--comp:${p.palette.complements[0]}`,
    ...c.slice(0, 5).map((h, i) => `--c${i + 1}:${h}`),
  ].join(";");
}

function frame(p, { eager = false } = {}) {
  const orient = p.width / p.height > 1.15 ? "landscape" : "portrait";
  return `<figure class="frame ${orient}" style="${paletteVars(p)}" data-id="${esc(p.id)}">
    <a class="frame-link" href="${p.url}" aria-label="${esc(p.alt)}">
      <div class="canvas">${pictureTag(p, { eager })}</div>
    </a>
    <figcaption>${exifStrip(p)}</figcaption>
    ${p.story ? `<div class="story">${p.story}</div>` : ""}
  </figure>`;
}

// ── Head / SEO ──────────────────────────────────────────────────────────

function head({ title, desc, canonical, ogImage, accent, css, jsonLd, preload, cfg }) {
  const site = cfg.site;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="theme-color" content="${esc(accent)}">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(site.title)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
${site.twitter ? `<meta name="twitter:site" content="@${esc(site.twitter.replace(/^@/, ""))}">` : ""}
${ogImage ? `<meta name="twitter:image" content="${esc(ogImage)}">` : ""}
<link rel="preconnect" href="${esc(site.url)}">
${preload ? `<link rel="preload" as="image" href="${esc(preload)}" fetchpriority="high">` : ""}
<link rel="preload" as="font" type="font/woff2" href="/fonts/fira-code-400.woff2" crossorigin>
<link rel="sitemap" type="application/xml" href="/sitemap.xml">
<script type="application/ld+json">${jsonLd}</script>
<style>${css}</style>`;
}

const shell = (body) =>
  `<div class="ambient-photo" aria-hidden="true"></div><div class="ambient" aria-hidden="true"></div>${body}`;

function siteHeader(cfg, years) {
  return `<header class="site-header">
    <a class="brand" href="/">${esc(cfg.site.title)}<span class="dot">.</span></a>
    <span class="tagline">${esc(cfg.site.tagline)}</span>
    <nav class="site-nav">${years.map((y) => `<a href="#y${y}">${y}</a>`).join("")}</nav>
  </header>`;
}
const siteFooter = (cfg) =>
  `<footer class="site-footer">
    <span>© ${esc(cfg.site.author)} · <a href="/LICENSE.txt">MIT</a></span>
    <span>${'${count}'} photos · shot on Nikon · built with <a href="https://qrp.nemanja.top/">qrp</a> · zero hand-written CSS</span>
  </footer>`;

// ── Pages ─────────────────────────────────────────────────────────────────

function fmtDay(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "long", day: "numeric" });
}
function fmtMonth(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function renderIndex({ months, all, cfg, css, appJs, dataJson }) {
  const years = [...new Set(all.map((p) => new Date(p.date).getFullYear()))].sort((a, b) => b - a);
  const hero = all[0];
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ImageGallery",
    name: cfg.site.title,
    description: cfg.site.description,
    url: cfg.site.url + "/",
    author: { "@type": "Person", name: cfg.site.author },
    image: all.slice(0, 40).map((p) => cfg.site.url + p.fallback),
  });

  let lastYear = null;
  const sections = months
    .map(({ month, photos }) => {
      const y = Number(month.slice(0, 4));
      const anchor = y !== lastYear ? ` id="y${y}"` : "";
      lastYear = y;
      return `<section class="month"${anchor}>
        <div class="day-marker" style="--accent:${photos[0].palette.accent}">
          <time datetime="${month}">${fmtMonth(month)}</time>
          <span class="rule"></span>
        </div>
        <div class="grid">${photos.map((p) => frame(p, { eager: p === hero })).join("")}</div>
      </section>`;
    })
    .join("");

  const body = shell(`${siteHeader(cfg, years)}
    <main class="timeline">${sections}</main>
    ${siteFooter(cfg).replace("${count}", all.length)}`);

  return `<!doctype html>
<html lang="${cfg.site.lang}" class="no-js">
<head>${head({
    title: `${cfg.site.title} — ${cfg.site.tagline}`,
    desc: cfg.site.description,
    canonical: cfg.site.url + "/",
    ogImage: hero ? cfg.site.url + hero.fallback : "",
    accent: hero ? hero.palette.accent : "#3bbfae",
    css, jsonLd, preload: hero ? hero.sizes[Math.min(2, hero.sizes.length - 1)].webp : "", cfg,
  })}</head>
<body>${body}
<script type="application/json" id="photo-data">${dataJson}</script>
<script type="module" src="${appJs}"></script>
</body></html>`;
}

export function renderPhotoPage({ p, prev, next, cfg, css, appJs }) {
  const d = p.exif.display || {};
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ImageObject",
    contentUrl: cfg.site.url + p.fallback,
    thumbnailUrl: cfg.site.url + p.sizes[0].webp,
    width: p.width, height: p.height,
    dateCreated: p.date,
    creator: { "@type": "Person", name: cfg.site.author },
    description: [d.body, d.lens, d.strip].filter(Boolean).join(" · "),
    ...(p.exif.iso ? { exifData: [
      p.exif.aperture && { "@type": "PropertyValue", name: "aperture", value: `f/${p.exif.aperture}` },
      p.exif.shutter != null && { "@type": "PropertyValue", name: "exposureTime", value: d.shutter },
      p.exif.iso && { "@type": "PropertyValue", name: "isoSpeed", value: p.exif.iso },
      p.exif.focalLength && { "@type": "PropertyValue", name: "focalLength", value: d.focalLength },
    ].filter(Boolean) } : {}),
  });
  const title = `${[d.body, d.strip].filter(Boolean).join(" · ") || p.id} — ${cfg.site.title}`;

  const body = shell(`<header class="site-header">
      <a class="brand" href="/">${esc(cfg.site.title)}<span class="dot">.</span></a>
      <span class="tagline">${fmtDay(p.date)}</span>
    </header>
    <main class="photo-page" style="${paletteVars(p)}">
      <div class="stage">${pictureTag(p, { sizes: SIZES_HERO, eager: true })}</div>
      <div class="meta">
        <p>${exifStrip(p)}</p>
        ${p.exif.details?.length ? `<p class="gear" style="color:var(--faint)">${p.exif.details.map((r) => `${esc(r.label)} ${esc(r.value)}`).join("   ·   ")}</p>` : ""}
        ${p.story ? `<div class="story">${p.story}</div>` : ""}
        <p><a class="dl-btn" href="${p.download}" download="${p.id}.jpg">↓ download full resolution</a></p>
        <p><a class="backlink" href="/">← back to the timeline</a></p>
      </div>
      <nav class="pager">
        <span>${prev ? `<a href="${prev.url}">← ${esc(prev.exif.display?.strip || "previous")}</a>` : ""}</span>
        <span>${next ? `<a href="${next.url}">${esc(next.exif.display?.strip || "next")} →</a>` : ""}</span>
      </nav>
    </main>`);

  return `<!doctype html>
<html lang="${cfg.site.lang}" class="no-js">
<head>${head({
    title, desc: [d.body, d.lens, d.strip, fmtDay(p.date)].filter(Boolean).join(" · "),
    canonical: cfg.site.url + p.url, ogImage: cfg.site.url + p.fallback,
    accent: p.palette.accent, css, jsonLd,
    preload: p.sizes[Math.min(3, p.sizes.length - 1)].webp, cfg,
  })}</head>
<body>${body}
<script type="module" src="${appJs}"></script>
</body></html>`;
}

export function renderSitemap(all, cfg) {
  const urls = ["/", ...all.map((p) => p.url)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${esc(cfg.site.url + u)}</loc></url>`).join("\n")}
</urlset>`;
}

export const robotsTxt = (cfg) => `User-agent: *
Allow: /
Sitemap: ${cfg.site.url}/sitemap.xml
`;
