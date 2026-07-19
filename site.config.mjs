// ─────────────────────────────────────────────────────────────────────────
//  Site configuration — the one file you edit by hand.
//  Everything else (photos, timeline, colors, SEO) is generated from your
//  photos at build time.
// ─────────────────────────────────────────────────────────────────────────

export default {
  site: {
    title: "Photography",
    // Shown in the header and used as the default <title> suffix.
    tagline: "a timeline, oversaturated",
    author: "Nemanja Nedeljkovic",
    description:
      "A chronological gallery of technical photography — shot on Nikon, " +
      "processed to punch, published without touching a line of CSS.",
    // Canonical origin — drives <link rel=canonical>, OG URLs, sitemap.
    // Set this to your real Render URL (no trailing slash).
    // Permanent home (DNS pending). Until it resolves, the site also works at
    // the Render URL — canonical/OG point here so SEO settles on the real home.
    url: "https://photography.nemanja.top",
    lang: "en",
    // Optional social handle for Twitter cards (with or without @).
    twitter: "",
  },

  // ── The image pipeline (build.mjs) ──────────────────────────────────────
  build: {
    outDir: "dist",
    photosDir: "photos",

    // Responsive widths, in CSS px. Each is capped to the master's real
    // width — the pipeline NEVER upscales, so nothing looks soft.
    // Small ones keep phones on a tiny-data diet; big ones make 4K sing.
    widths: [480, 800, 1200, 1600, 2400, 3200],

    // Modern formats emitted per size, best-first. A JPEG fallback is
    // always written so every browser gets something.
    formats: ["avif", "webp"],
    quality: { avif: 46, webp: 74, jpeg: 82 },

    // The 6×2-ish inline blur placeholder — a few dozen bytes, base64'd
    // straight into the HTML so it paints on the first byte.
    lqip: { maxEdge: 24, quality: 40 },

    // How many dominant colors to pull per photo (drives the color splash).
    paletteColors: 6,

    // Saturation applied to PUBLISHED images. 100 = preserve your look
    // untouched (you oversaturate in-camera / Lightroom). Bump >100 to let
    // the pipeline punch color for you, e.g. 128 for +28%.
    saturate: 100,
  },

  // ── The ingest tool (ingest.mjs) ────────────────────────────────────────
  ingest: {
    // Working-master cap (long edge, px). Big enough to feed 4K beautifully,
    // small enough that git/GitHub stay happy. Never commit full RAW.
    masterMaxEdge: 4096,
    masterQuality: 92,
    // false = copy originals into photos/ (safe). true = move them.
    move: false,
  },

  // ── EXIF allowlist — DEFAULT DENY ───────────────────────────────────────
  // ONLY these fields are ever read into the manifest / rendered / published.
  // Everything else (GPS, serial numbers, owner name, software, maker notes)
  // is dropped and never leaves your machine. Published image binaries are
  // additionally `-strip`'d to zero metadata regardless of this list.
  //
  // GPS is deliberately absent. Add "gps" here only if you want location
  // published — it is off by default, on purpose.
  exifAllow: [
    "make",
    "model",
    "lens",
    "focalLength",
    "aperture",
    "shutter",
    "iso",
    "dateTime",
  ],
};
