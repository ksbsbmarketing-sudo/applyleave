// Generates the print-only brand assets in public/print/ from the source logos in public/.
//   wm-<brand>.png  — watermark: single-tone silhouette in the brand accent, transparent
//                     background, trimmed. Printed at low opacity behind every form/report.
//   hdr-<brand>.png — header logo: the original logo with its empty margins trimmed off,
//                     so every brand fills the same header height.
// Run after changing a logo:  node gen_print_assets.cjs
// Uses puppeteer's canvas because the project has no image library.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const PUB = path.join(__dirname, 'public');
const OUT = path.join(PUB, 'print');

// mode 'dark'  — ink = how dark a pixel is (logo drawn on white/transparent).
// mode 'disc'  — ink = how LIGHT a pixel is inside a dark disc (KR: white letters on a
//                black circle). Using 'dark' there would print a solid grey blob.
const JOBS = [
  { brand: 'ksb',     wm: { src: 'logo-ksb-mark.png',    mode: 'dark', color: '#9b2c2c' }, hdr: 'logo-ksb-mark.png' },
  { brand: 'bentong', wm: { src: 'logo-bentong.png',     mode: 'dark', color: '#283a6e' }, hdr: 'logo-bentong.png' },
  { brand: 'pharma',  wm: { src: 'logo-ksb-pharma.png',  mode: 'dark', color: '#0f3d2e' }, hdr: 'logo-ksb-pharma.png' },
  { brand: 'ksbymc',  wm: { src: 'logo-ksbymc-mark.png', mode: 'dark', color: '#c81e28' }, hdr: 'logo-ksbymc-mark.png' },
  { brand: 'kr',      wm: { src: 'logo-kr.png',          mode: 'disc', color: '#1a1a1a' }, hdr: 'logo-kr.png' },
];

function pageScript() {
  // Runs in the browser. Returns a PNG data URL.
  window.process = async (dataUrl, opts) => {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const px = d.data;
    const W = c.width, H = c.height;
    const hex = opts.color ? opts.color.replace('#', '') : null;
    const [tr, tg, tb] = hex ? [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) : [0, 0, 0];
    const cx = W / 2, cy = H / 2, rr = Math.min(W, H) * 0.36; // KR disc interior
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const a = px[i + 3] / 255;
        const L = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
        let keep;
        if (opts.mode === 'trim') {
          keep = a > 0.04 && L < 0.93;
        } else {
          let ink;
          if (opts.mode === 'disc') {
            const inDisc = (x - cx) ** 2 + (y - cy) ** 2 < rr * rr;
            ink = inDisc ? Math.max(0, (L - 0.35) / 0.65) : 0;
          } else {
            ink = Math.min(1, Math.max(0, (1 - L - 0.06) * 1.6));
          }
          ink *= a;
          px[i] = tr; px[i + 1] = tg; px[i + 2] = tb; px[i + 3] = Math.round(ink * 255);
          keep = ink > 0.04;
        }
        if (keep) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
    }
    if (opts.mode !== 'trim') ctx.putImageData(d, 0, 0);
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.02);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
    const o = document.createElement('canvas');
    o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return o.toDataURL('image/png');
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.evaluate(pageScript);
  const toDataUrl = f => 'data:image/png;base64,' + fs.readFileSync(path.join(PUB, f)).toString('base64');
  const save = (name, url) => {
    fs.writeFileSync(path.join(OUT, name), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote public/print/' + name);
  };
  for (const j of JOBS) {
    save(`wm-${j.brand}.png`, await page.evaluate((u, o) => window.process(u, o), toDataUrl(j.wm.src), j.wm));
    save(`hdr-${j.brand}.png`, await page.evaluate((u, o) => window.process(u, o), toDataUrl(j.hdr), { mode: 'trim' }));
  }
  await browser.close();
})();
