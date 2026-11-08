// Renders the "page is translated" toolbar icon: the stock logo, untouched in
// size and position, with a green check badge over the bottom-right corner —
// the same badge the float ball's docked switch shows (#23A455 disc, white
// ring, white check). The badge is allowed to cover a sliver of the green
// bubble; shrinking or shifting the logo to avoid that was tried and rejected,
// the icon has to stay recognisably the same icon.
//
//   pnpm icon:translated          → public/icon/translated/{16,32,48,128}.png
//   pnpm icon:translated --check  → also reports how much of the logo the badge covers
//
// Rasterised with Playwright's bundled Chromium (already a dev dependency for
// e2e), so no system-level SVG tooling is needed.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/icon/translated');
const SIZES = [16, 32, 48, 128];

// Everything in the logo's 1024-unit viewBox.
const LOGO_SCALE = 1;   
const LOGO_Y = 0;             // translate before scaling; artwork spans y≈112..904
const BADGE_R = 184;          // green disc radius
const BADGE_RING = 50;        // white ring width
const BADGE_CX = 1024 - BADGE_R - BADGE_RING;
const BADGE_CY = BADGE_CX;
const CHECK_SCALE = 12;       // lucide 24-unit grid → viewBox units
const CHECK_STROKE = 6.2;     // in lucide units (float ball uses 3 at 14px; thicker here for 16px)

const logo = readFileSync(resolve(root, 'public/DuoTranslator.svg'), 'utf8')
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');

const check = `<path transform="translate(${BADGE_CX - 12 * CHECK_SCALE} ${BADGE_CY - 12 * CHECK_SCALE}) scale(${CHECK_SCALE})" d="M20 6 9 17l-5-5" fill="none" stroke="#fff" stroke-width="${CHECK_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>`;

function svg({ logoLayer = true, badgeLayer = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="100%" height="100%" fill="none">
  ${logoLayer ? `<g transform="scale(${LOGO_SCALE}) translate(0 ${LOGO_Y})">${logo}</g>` : ''}
  ${badgeLayer ? `<circle cx="${BADGE_CX}" cy="${BADGE_CY}" r="${BADGE_R + BADGE_RING}" fill="#fff"/>
  <circle cx="${BADGE_CX}" cy="${BADGE_CY}" r="${BADGE_R}" fill="#23A455"/>
  ${check}` : ''}
</svg>`;
}

async function render(page, markup, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${markup}</body></html>`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

// Minimal PNG decode (8-bit RGBA, non-interlaced) for the overlap check.
function alphaMask(png) {
  let p = 8, idat = [], w, h;
  while (p < png.length) {
    const len = png.readUInt32BE(p), type = png.toString('ascii', p + 4, p + 8);
    const data = png.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp, mask = new Uint8Array(w * h);
  let prev = Buffer.alloc(stride);
  for (let y = 0, i = 0; y < h; y++) {
    const f = raw[i++], line = raw.subarray(i, i + stride), cur = Buffer.alloc(stride);
    i += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    for (let x = 0; x < w; x++) mask[y * w + x] = cur[x * 4 + 3] > 24 ? 1 : 0;
    cur.copy(prev);
  }
  return { w, h, mask };
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  writeFileSync(resolve(outDir, `${size}.png`), await render(page, svg(), size));
}
if (process.argv.includes('--check')) {
  const a = alphaMask(await render(page, svg({ badgeLayer: false }), 128));
  const b = alphaMask(await render(page, svg({ logoLayer: false }), 128));
  let overlap = 0, x0 = 128, y0 = 128, x1 = -1, y1 = -1;
  for (let i = 0; i < a.mask.length; i++) {
    if (!(a.mask[i] && b.mask[i])) continue;
    overlap++;
    const x = i % 128, y = (i / 128) | 0;
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const logoPx = a.mask.reduce((n, v) => n + v, 0);
  console.log(`badge covers ${overlap} px of the logo at 128px (${((overlap / logoPx) * 100).toFixed(1)}%)` + (overlap ? ` in x ${x0}..${x1}, y ${y0}..${y1}` : ''));
}
// Pixel-zoomed contact sheet for eyeballing the small sizes.
const tiles = SIZES.map((s) => `<img src="data:image/png;base64,${readFileSync(resolve(outDir, `${s}.png`)).toString('base64')}" style="width:128px;height:128px;image-rendering:pixelated;margin:8px;background:#fff">`).join('');
await page.setViewportSize({ width: 600, height: 300 });
await page.setContent(`<body style="margin:0;background:#2b2b2b;display:flex;align-items:center;flex-wrap:wrap">${tiles}${tiles.replace(/background:#fff/g, 'background:#1f1f1f')}</body>`);
writeFileSync(resolve(root, process.env.PREVIEW_OUT ?? '/dev/null'), await page.screenshot());
await browser.close();
