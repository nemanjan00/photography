import exifr from "exifr";

// We ask exifr for a broad read, then pull ONLY the fields we map below.
// The allowlist is enforced here in code: anything not mapped is discarded,
// so GPS / serials / owner / software can't reach the manifest by accident.

const PICK = {
  // exifr key(s) → our canonical field
  make: (d) => d.Make,
  model: (d) => d.Model,
  lens: (d) => d.LensModel || d.LensID || d.Lens || d.LensInfo,
  focalLength: (d) => num(d.FocalLength),
  focalLength35: (d) => num(d.FocalLengthIn35mmFormat),
  aperture: (d) => num(d.FNumber ?? d.ApertureValue),
  shutter: (d) => num(d.ExposureTime),
  iso: (d) => int(d.ISO ?? d.ISOSpeedRatings ?? d.PhotographicSensitivity),
  dateTime: (d) =>
    toISO(d.DateTimeOriginal || d.CreateDate || d.DateTimeDigitized || d.ModifyDate),
};

function num(v) {
  if (v == null) return null;
  const n = Array.isArray(v) ? v[0] / (v[1] || 1) : Number(v);
  return Number.isFinite(n) ? n : null;
}
function int(v) {
  const n = num(Array.isArray(v) ? v[0] : v);
  return n == null ? null : Math.round(n);
}
function toISO(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d) ? null : d.toISOString();
}

/**
 * Read allowlisted EXIF from any file exifr understands (JPEG, HEIC, TIFF,
 * and NEF/RAW — read-only). Returns { raw fields } + display strings.
 * Fields the `allow` list omits are stripped from the result.
 */
export async function readExif(file, allow) {
  let d = null;
  try {
    d = await exifr.parse(file, { tiff: true, ifd0: true, exif: true, gps: false });
  } catch {
    d = null;
  }
  d = d || {};

  const out = {};
  for (const [field, get] of Object.entries(PICK)) {
    const base = field === "focalLength35" ? "focalLength" : field;
    if (!allow.includes(base)) continue; // default-deny
    const v = get(d);
    if (v != null && v !== "") out[field] = v;
  }
  return { ...out, display: displayStrings(out), details: curiosities(d, out) };
}

// ── The weird, unexpected, non-identifying extras ─────────────────────────
const METER = { 0: "unknown", 1: "average", 2: "center-weighted", 3: "spot", 4: "multi-spot", 5: "matrix", 6: "partial" };
const PROGRAM = { 0: "manual*", 1: "manual", 2: "program AE", 3: "aperture priority", 4: "shutter priority", 5: "creative", 6: "action", 7: "portrait", 8: "landscape" };
const WB = { 0: "auto", 1: "manual" };

function curiosities(d, picked) {
  const rows = [];
  const push = (label, value) => {
    const v = value == null ? "" : String(value);
    if (v && !/^(unknown|not defined|undefined|n\/a|reserved)$/i.test(v)) rows.push({ label, value: v });
  };

  // 35mm-equivalent field of view
  if (picked.focalLength35 && picked.focalLength35 !== picked.focalLength)
    push("full-frame eq.", `${Math.round(picked.focalLength35)}mm`);

  // computed light value (EV @ ISO100) — the "how bright was it" number
  if (picked.aperture && picked.shutter && picked.iso) {
    const ev = Math.log2((picked.aperture ** 2) / picked.shutter) - Math.log2(picked.iso / 100);
    push("light value", `EV ${ev.toFixed(1)}`);
  }

  const ec = num(d.ExposureCompensation);
  if (ec != null && ec !== 0) push("exp. comp", `${ec > 0 ? "+" : ""}${trimZeros(ec)} EV`);
  push("metering", typeof d.MeteringMode === "number" ? METER[d.MeteringMode] : d.MeteringMode);
  push("program", typeof d.ExposureProgram === "number" ? PROGRAM[d.ExposureProgram] : d.ExposureProgram);
  push("white balance", typeof d.WhiteBalance === "number" ? WB[d.WhiteBalance] : d.WhiteBalance);
  if (d.Flash != null) push("flash", /no|not fire|off/i.test(String(d.Flash)) ? "no flash" : /fire|on|yes/i.test(String(d.Flash)) ? "fired" : String(d.Flash));
  const sd = num(d.SubjectDistance);
  if (sd && sd < 1000) push("subject dist.", `${trimZeros(sd)} m`);
  if (d.ColorSpace) push("color space", d.ColorSpace === 1 ? "sRGB" : String(d.ColorSpace));
  return rows;
}

/** Human-readable, hacker-terse EXIF strings. */
export function displayStrings(x) {
  const d = {};
  if (x.aperture) d.aperture = `ƒ/${trimZeros(x.aperture)}`;
  if (x.shutter != null) d.shutter = fmtShutter(x.shutter);
  if (x.iso) d.iso = `ISO ${x.iso}`;
  if (x.focalLength) d.focalLength = `${Math.round(x.focalLength)}mm`;
  const body = [x.make, x.model].filter(Boolean).join(" ").replace(/\bNIKON\b/i, "Nikon");
  if (body) d.body = dedupeMakeModel(x.make, x.model);
  if (x.lens) d.lens = String(x.lens);
  // A single terse strip, the way a photographer reads it.
  d.strip = [d.aperture, d.shutter, d.iso, d.focalLength].filter(Boolean).join(" · ");
  return d;
}

function fmtShutter(t) {
  if (t >= 1) return `${trimZeros(t)}s`;
  const denom = Math.round(1 / t);
  return `1/${denom}s`;
}
function trimZeros(n) {
  return String(Number(n.toFixed(2))).replace(/\.0+$/, "");
}
function dedupeMakeModel(make, model) {
  if (!model) return make || "";
  if (!make) return model;
  // "NIKON" + "NIKON Z 8" → "Nikon Z 8"
  const m = String(make).replace(/\bNIKON CORPORATION\b/i, "Nikon").replace(/\bNIKON\b/i, "Nikon");
  const mod = String(model);
  if (mod.toLowerCase().includes(m.toLowerCase())) return mod.replace(/\bNIKON\b/i, "Nikon");
  return `${m} ${mod}`;
}
