/**
 * Renders the 3D mark's brand stills into public/brand/:
 *
 *   hackos-mark-3d-1024.png     1024×1024, transparent, the resting pose
 *   hackos-social-3d-1200x630.png  a social card built around it
 *
 * The stills come from the same shader the site runs
 * (src/components/brand/logo3dScene.ts), rendered at twice the size and
 * scaled down, in headless Chromium. The social card borrows the site's own
 * fonts, so the web app must be running:
 *
 *   SITE_URL=http://localhost:3000 node scripts/export-brand-stills.mjs
 *
 * Needs Playwright with a Chromium build (PLAYWRIGHT_MODULE and
 * CHROMIUM_PATH point at them when they are not installed in the project).
 */

import { createRequire } from "module";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(process.env.PLAYWRIGHT_MODULE || path.join(root, "package.json"));
const { chromium } = require("playwright");
const SITE_URL = process.env.SITE_URL || "http://localhost:3000";
const out = path.join(root, "public", "brand");
mkdirSync(out, { recursive: true });

// Bundle the renderer into one script the page can load.
const work = mkdtempSync(path.join(tmpdir(), "hackos-brand-"));
const bundle = path.join(work, "logo3d.js");
execFileSync(
  process.execPath,
  [path.join(root, "node_modules/rolldown/bin/cli.mjs"), path.join(root, "src/components/brand/logo3dScene.ts"),
    "--format", "iife", "--name", "Logo3D", "--file", bundle],
  { stdio: "ignore" },
);
const renderer = `window.process={env:{NODE_ENV:"production"}};\n${readFileSync(bundle, "utf8")}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
});

/** Renders the mark at 2× and returns a PNG data URL scaled to `size`. */
async function still(page, size, options) {
  return page.evaluate(
    ({ size, options }) => {
      const big = document.createElement("canvas");
      if (!window.Logo3D.renderLogoStill(big, { size: size * 2, ...options })) throw new Error("WebGL unavailable");
      const small = document.createElement("canvas");
      small.width = small.height = size;
      const ctx = small.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(big, 0, 0, size, size);
      return small.toDataURL("image/png");
    },
    { size, options },
  );
}

const save = (name, dataUrl) => {
  writeFileSync(path.join(out, name), Buffer.from(dataUrl.split(",")[1], "base64"));
  console.log("wrote", path.relative(root, path.join(out, name)));
};

// 1. The transparent square still.
{
  const page = await browser.newPage();
  await page.setContent("<!doctype html><html><body></body></html>");
  await page.addScriptTag({ content: renderer });
  save("hackos-mark-3d-1024.png", await still(page, 1024, { frame: 1.3, shadow: false }));
  await page.close();
}

// 2. The social card, laid out in HTML with the site's fonts.
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  // Borrow the site's @font-face rules and family name, then lay the card
  // out on a blank page (the live app would re-render over it).
  await page.goto(`${SITE_URL}/welcome`, { waitUntil: "load" });
  const { faces, family } = await page.evaluate(() => {
    const faces = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        if (r instanceof CSSFontFaceRule) {
          faces.push(r.cssText.replace(/url\((["']?)(\/[^)"']+)\1\)/g, (_, q, u) => `url(${q}${location.origin}${u}${q})`));
        }
      }
    }
    const family = getComputedStyle(document.querySelector("[data-site-root]") || document.body).fontFamily;
    return { faces, family };
  });
  await page.setContent(`<!doctype html><html><head><style>${faces.join("\n")} body{margin:0}</style></head><body></body></html>`);
  await page.addScriptTag({ content: renderer });
  const mark = await still(page, 600, { frame: 1.55, shadow: true, dark: true });
  await page.evaluate(({ mark, family }) => {
    document.body.innerHTML = `
      <div id="card" style="position:relative;width:1200px;height:630px;overflow:hidden;background:#0A0B0F;font-family:${family.replace(/"/g, "'")};color:#F4F6FA">
        <div style="position:absolute;inset:0;background:radial-gradient(520px 420px at 905px 300px,rgba(225,0,60,.30),rgba(225,0,60,0) 70%),radial-gradient(700px 500px at 0 0,rgba(225,0,60,.10),rgba(225,0,60,0) 70%)"></div>
        <div style="position:absolute;inset:0;opacity:.06;background-image:linear-gradient(#F4F6FA 1px,transparent 1px),linear-gradient(90deg,#F4F6FA 1px,transparent 1px);background-size:40px 40px;-webkit-mask-image:linear-gradient(90deg,#000,transparent 70%)"></div>
        <img src="${mark}" style="position:absolute;left:605px;top:15px;width:600px;height:600px" alt="">
        <div style="position:absolute;left:84px;top:96px;width:560px">
          <div style="font-size:30px;font-weight:600;letter-spacing:-0.02em">HackOS</div>
          <div style="margin-top:48px;font-size:60px;line-height:1.04;font-weight:600;letter-spacing:-0.035em">
            <span style="color:#A8B0BE">Run your hackathon<br>on software</span><br><span>built for it.</span>
          </div>
          <div style="margin-top:30px;font-size:21px;line-height:1.5;color:#A8B0BE;max-width:520px">Registration, teams, judging, results and reporting in one platform, with a view for every role.</div>
        </div>
        <div style="position:absolute;left:84px;bottom:64px;font-size:18px;color:#7C8496;letter-spacing:0.02em">hack-os.app</div>
      </div>`;
  }, { mark, family });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const png = await page.locator("#card").screenshot({ type: "png" });
  writeFileSync(path.join(out, "hackos-social-3d-1200x630.png"), png);
  console.log("wrote", "public/brand/hackos-social-3d-1200x630.png");
  await page.close();
}

await browser.close();
