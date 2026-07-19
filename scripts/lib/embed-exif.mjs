import piexif from "piexifjs";
import exifr from "exifr";
import fs from "node:fs/promises";

// Write the allowlisted EXIF from an ORIGINAL (e.g. a NEF, whose embedded JPEG
// preview carries none) into the derived JPG master, so the committed JPG is
// self-contained. DEFAULT-DENY: only allowlisted fields are written; GPS and
// everything else are never embedded. exifr reads these straight back at build.

const num = (v) => (v == null ? null : Array.isArray(v) ? v[0] / (v[1] || 1) : Number(v));
const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
const fRatio = (x) => [Math.round(x * 10), 10];
const focalR = (x) => [Math.round(x * 10), 10];
const expTime = (x) => (x >= 1 ? [Math.round(x * 10), 10] : [1, Math.round(1 / x)]);
const sRatio = (x) => [Math.round(x * 100), 100];
const dist = (x) => [Math.round(x * 100), 100];
function fmtDT(v) {
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return null;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export async function embedExifFromOriginal(originalPath, jpgPath, allow) {
  // read raw NUMERIC values (no translation) so codes embed as codes
  const d = await exifr.parse(originalPath, {
    translateValues: false, reviveValues: true, tiff: true, ifd0: true, exif: true, gps: false,
  }).catch(() => null);
  if (!d) return false;

  const on = (f) => allow.includes(f);
  const I = piexif.ImageIFD, E = piexif.ExifIFD;
  const zeroth = {}, exif = {};

  if (on("make") && d.Make) zeroth[I.Make] = String(d.Make);
  if (on("model") && d.Model) zeroth[I.Model] = String(d.Model);
  if (on("lens") && (d.LensModel || d.LensID)) exif[E.LensModel] = String(d.LensModel || d.LensID);
  if (on("dateTime")) { const dt = fmtDT(d.DateTimeOriginal || d.CreateDate || d.DateTimeDigitized); if (dt) { exif[E.DateTimeOriginal] = dt; zeroth[I.DateTime] = dt; } }
  if (on("aperture") && d.FNumber != null) exif[E.FNumber] = fRatio(num(d.FNumber));
  if (on("shutter") && d.ExposureTime != null) exif[E.ExposureTime] = expTime(num(d.ExposureTime));
  if (on("iso")) { const iso = int(d.ISO ?? d.ISOSpeedRatings ?? d.PhotographicSensitivity); if (iso) exif[E.ISOSpeedRatings] = iso; }
  if (on("focalLength") && d.FocalLength != null) {
    exif[E.FocalLength] = focalR(num(d.FocalLength));
    const f35 = int(d.FocalLengthIn35mmFormat); if (f35) exif[E.FocalLengthIn35mmFilm] = f35;
  }

  // non-identifying curiosities (safe to publish; not gated per-field)
  if (d.ExposureCompensation != null) exif[E.ExposureBiasValue] = sRatio(num(d.ExposureCompensation));
  if (typeof d.MeteringMode === "number") exif[E.MeteringMode] = d.MeteringMode;
  if (typeof d.ExposureProgram === "number") exif[E.ExposureProgram] = d.ExposureProgram;
  if (typeof d.WhiteBalance === "number") exif[E.WhiteBalance] = d.WhiteBalance;
  if (typeof d.Flash === "number") exif[E.Flash] = d.Flash;
  if (typeof d.ColorSpace === "number") exif[E.ColorSpace] = d.ColorSpace;
  const sd = num(d.SubjectDistance); if (sd && sd < 1000) exif[E.SubjectDistance] = dist(sd);

  if (!Object.keys(zeroth).length && !Object.keys(exif).length) return false;

  const bytes = piexif.dump({ "0th": zeroth, Exif: exif, GPS: {} });
  const jpg = (await fs.readFile(jpgPath)).toString("binary");
  await fs.writeFile(jpgPath, Buffer.from(piexif.insert(bytes, jpg), "binary"));
  return true;
}
