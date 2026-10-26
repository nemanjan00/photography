import { engine } from "./engine.mjs";

// ── Color math ──────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}
function hslToRgb(h, s, l) {
  h /= 360;
  if (s === 0) { const v = l * 255; return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const t = (x) => {
    if (x < 0) x += 1; if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [t(h + 1 / 3), t(h), t(h - 1 / 3)].map((v) => v * 255);
}

/** Complement = hue rotated 180°, kept vivid. */
export function complement(hex) {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb((h + 180) % 360, Math.max(s, 0.45), clamp(l, 0.4, 0.6)));
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ── Extraction ────────────────────────────────────────────────────────────

/**
 * Pull dominant colors from an image via ImageMagick quantization, then
 * re-rank so vivid, saturated colors win over a large dull background —
 * this is what makes the "splash" pop instead of turning muddy grey.
 */
export async function extractPalette(file, n = 6) {
  const colors = await (await engine()).rawColors(file, n);

  const entries = colors.map(({ r, g, b, count }) => {
    const rgb = [r, g, b].map((v) => Math.round(v));
    const hex = rgbToHex(rgb);
    const [h, s, l] = rgbToHsl(rgb);
    return { hex, count, h, s, l };
  });
  if (!entries.length) return fallback(n);

  const total = entries.reduce((a, e) => a + e.count, 0) || 1;
  // Weight to make the color splash *pop*: heavily favor saturation and vivid
  // mid-tones; punish near-neutral greys and near-black/white hard, so a flat
  // dark background never becomes a "dominant" color.
  for (const e of entries) {
    const area = e.count / total;
    const lumPenalty = e.l < 0.12 || e.l > 0.92 ? 0.15 : 1;
    const greyPenalty = e.s < 0.12 ? 0.3 : 1;
    const midness = Math.max(0, 1 - Math.abs(e.l - 0.52) * 1.6);
    e.score = (area * 0.3 + e.s * 1.25 + midness * 0.35) * lumPenalty * greyPenalty;
  }
  entries.sort((a, b) => b.score - a.score);

  // Spread across hues so we don't return five near-identical teals.
  const picked = [];
  for (const e of entries) {
    if (picked.length >= n) break;
    if (picked.some((p) => hueDist(p.h, e.h) < 18 && Math.abs(p.l - e.l) < 0.12)) continue;
    picked.push(e);
  }
  while (picked.length < n && entries.length) picked.push(entries[picked.length % entries.length]);

  const dominant = picked.slice(0, n).map((e) => e.hex);
  const complements = dominant.map(complement);

  // The single most usable accent: vivid, mid-luminance.
  const accent =
    picked.slice().sort((a, b) => b.s * (1 - Math.abs(b.l - 0.55)) - a.s * (1 - Math.abs(a.l - 0.55)))[0]?.hex ||
    dominant[0];

  // `accent` is UI color — text on the dark page and a button fill under dark
  // text — so lift it to WCAG AA contrast; `tone` keeps the photo's real hue
  // and depth for the background gradient.
  return { dominant, complements, accent: legible(accent), tone: accent };
}

const BG = [8, 8, 11];
function luminance([r, g, b]) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** Lighten (same hue) until ≥4.6:1 against the page background. */
export function legible(hex) {
  const bgL = luminance(BG);
  let [h, s, l] = rgbToHsl(hexToRgb(hex));
  let rgb = hexToRgb(hex);
  while ((luminance(rgb) + 0.05) / (bgL + 0.05) < 4.6 && l < 0.97) {
    l = Math.min(0.97, l + 0.02);
    rgb = hslToRgb(h, s, l);
  }
  return rgbToHex(rgb);
}

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
function fallback(n) {
  const base = ["#3bbfae", "#a23b27", "#489f27", "#8f7465", "#1b1814", "#e0c341"];
  const dominant = base.slice(0, n);
  return { dominant, complements: dominant.map(complement), accent: legible(dominant[0]), tone: dominant[0] };
}
