#!/usr/bin/env node
// Makes the iPhone launch screens (apple-touch-startup-image) in public/splash
// from the app icon: the barbell on the app's dark background. Run again only
// if the icon changes: node scripts/make-splash.mjs (needs Playwright).
// Android builds its splash from manifest.json (name, background, icon).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// Portrait CSS size and pixel ratio of each iPhone screen size (newest first).
export const SCREENS = [
  [440, 956, 3], // 16/17 Pro Max
  [420, 912, 3], // Air
  [402, 874, 3], // 16/17 Pro, 17
  [430, 932, 3], // 14/15 Pro Max, 15/16 Plus
  [393, 852, 3], // 14/15 Pro, 15, 16
  [428, 926, 3], // 12/13 Pro Max, 14 Plus
  [390, 844, 3], // 12, 13, 14, 12/13 Pro, 16e
  [375, 812, 3], // X, XS, 11 Pro, 12/13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [414, 736, 3], // 6/7/8 Plus
  [375, 667, 2], // 6/7/8, SE (2nd/3rd)
  [320, 568, 2], // SE (1st)
];

const icon = readFileSync('public/icons/maskable-512.png').toString('base64');
mkdirSync('public/splash', { recursive: true });
const browser = await chromium.launch();
const links = [];
for (const [w, h, dpr] of SCREENS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await page.setContent(`<html><body style="margin:0;background:#0B0D10;height:100vh;display:flex;
    flex-direction:column;align-items:center;justify-content:center;gap:4px;font-family:-apple-system,system-ui,sans-serif">
    <img src="data:image/png;base64,${icon}" style="width:${Math.round(w * 0.42)}px;height:${Math.round(w * 0.42)}px">
    <div style="color:#E6E8EB;font-size:22px;font-weight:700;letter-spacing:.2px">LightweightBaby</div></body></html>`);
  const name = `splash-${w * dpr}x${h * dpr}.png`;
  writeFileSync(`public/splash/${name}`, await page.screenshot({ type: 'png' }));
  await page.close();
  links.push(
    `    <link rel="apple-touch-startup-image" href="/splash/${name}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" />`,
  );
}
await browser.close();
console.log(links.join('\n'));
