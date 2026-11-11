// Test: swap background red->blue, and inspect the REAL SoundCloud spinner.
const puppeteer = require('puppeteer-core');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function crc32(buf) { let c, crc = 0xffffffff; for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(t, d) { const ty = Buffer.from(t, 'ascii'); const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([ty, d]))); return Buffer.concat([l, ty, d, c]); }
function solidPng(r, g, bl, name) {
  const w = 64, h = 64, ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { const o = y * (w * 3 + 1); for (let x = 0; x < w; x++) { const p = o + 1 + x * 3; raw[p] = r; raw[p + 1] = g; raw[p + 2] = bl; } }
  const buf = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const f = path.join(__dirname, '..', 'test_screenshots', name); fs.writeFileSync(f, buf); return f;
}

(async () => {
  const red = solidPng(220, 30, 30, '_sw_red.png');
  const blue = solidPng(30, 90, 230, '_sw_blue.png');
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--window-size=1300,850'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1300, height: 850 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.evaluateOnNewDocument(() => localStorage.setItem('moonplayer_ui_mode', 'riff'));
  await p.goto('http://localhost:7644/index.html', { waitUntil: 'domcontentloaded' });
  await sleep(3000);

  const upload = async (file) => {
    const input = await p.$('#riff-bg-file');
    await input.uploadFile(file);
    await sleep(2000);
    return await p.evaluate(() => {
      const layer = document.getElementById('riff-custom-bg');
      return { bg: layer.style.backgroundImage.slice(0, 60), on: document.body.classList.contains('riff-custom-bg-on') };
    });
  };
  const r1 = await upload(red);
  console.log('after RED :', JSON.stringify(r1));
  await p.screenshot({ path: 'test_screenshots/swap_red.png' });
  const r2 = await upload(blue);
  console.log('after BLUE:', JSON.stringify(r2));
  await p.screenshot({ path: 'test_screenshots/swap_blue.png' });
  console.log('CHANGED:', r1.bg !== r2.bg);

  // Real spinner: force a slow-ish SoundCloud load and inspect the placeholder spinner.
  const spinner = await p.evaluate(async () => {
    // Clear cache so renderSoundCloudView goes into the loading branch
    if (window.RiffUI && window.RiffUI.getState) {
      const st = window.RiffUI.getState();
      st.scFeedCache = {}; st.scFeedLoading = {}; st.scFeedNext = {};
    }
    window.RiffUI.switchView('soundcloud');
    await new Promise(r => setTimeout(r, 120));
    const list = document.getElementById('sc-tracks-list');
    const el = list && list.querySelector('div[style*="animation:spin"]') || list && list.querySelector('div');
    if (!el) return { found: false, html: list ? list.innerHTML.slice(0, 200) : 'no list' };
    const cs = getComputedStyle(el);
    return {
      found: true, animName: cs.animationName, animDuration: cs.animationDuration,
      animPlay: cs.animationPlayState, display: cs.display,
      borderColor: cs.borderTopColor, text: list.textContent.trim().slice(0, 40)
    };
  });
  console.log('REAL SPINNER:', JSON.stringify(spinner));
  await p.screenshot({ path: 'test_screenshots/real_spinner.png' });
  console.log('Errors:', errs.length ? JSON.stringify(errs) : 'none');
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(2); });
