import { chromium } from "playwright-core";
import fs from "node:fs";

const exe = "/work/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome";
const base = process.env.BASE || "http://127.0.0.1:8787";
const outDir = "/tmp/shots";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const shots = [
  { name: "desktop", w: 1680, h: 1050, path: "/" },
  { name: "wide4k", w: 2560, h: 1440, path: "/" },
  { name: "mobile", w: 390, h: 844, path: "/", mobile: true },
  { name: "photo", w: 1680, h: 1050, path: null }, // filled below
];

const ctxDesk = await browser.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 1 });
const page = await ctxDesk.newPage();
await page.goto(base + "/", { waitUntil: "networkidle" });
// discover a photo url
const photoHref = await page.$eval("a.frame-link", (a) => a.getAttribute("href")).catch(() => null);
await ctxDesk.close();

for (const s of shots) {
  const ctx = await browser.newContext({
    viewport: { width: s.w, height: s.h },
    deviceScaleFactor: s.mobile ? 3 : 1,
    isMobile: !!s.mobile,
    hasTouch: !!s.mobile,
  });
  const p = await ctx.newPage();
  const url = base + (s.name === "photo" ? (photoHref || "/") : s.path);
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForTimeout(1200); // let blur-up + ambient settle
  await p.screenshot({ path: `${outDir}/${s.name}.png`, fullPage: s.name !== "wide4k" });
  console.log("shot:", s.name, "→", url);
  await ctx.close();
}

// also capture the lightbox open
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 } });
const p = await ctx.newPage();
await p.goto(base + "/", { waitUntil: "networkidle" });
await p.click("a.frame-link");
await p.waitForTimeout(900);
await p.screenshot({ path: `${outDir}/lightbox.png` });
console.log("shot: lightbox");
await browser.close();
