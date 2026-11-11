// Deep diagnostic: trace every step of background change and find where it fails.
const puppeteer = require('puppeteer-core');
const zlib = require('zlib');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const path = require('path');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function solidPng(r, g, b, name) {
  function crc32(buf) { let c, crc = 0xffffffff; for (let i = 0; i < buf.length; i++) { c = (crc ^ buf[i]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
  function chunk(t, d) { const ty = Buffer.from(t, 'ascii'); const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([ty, d]))); return Buffer.concat([l, ty, d, crc]); }
  const w = 128, h = 128, ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { const o = y * (w * 3 + 1); for (let x = 0; x < w; x++) { const p = o + 1 + x * 3; raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; } }
  const buf = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  const f = path.join(__dirname, '..', 'test_screenshots', name); fs.writeFileSync(f, buf); return f;
}

(async () => {
  const red  = solidPng(230, 30,  30,  '_diag_red.png');
  const green= solidPng(30,  200, 50,  '_diag_green.png');

  const b = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--window-size=1400,900'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 900 });
  const consoleLines = [];
  p.on('pageerror', e => consoleLines.push('PAGE-ERR: ' + e.message));
  p.on('console', m => consoleLines.push(m.type().toUpperCase() + ': ' + m.text().slice(0, 200)));
  await p.evaluateOnNewDocument(() => localStorage.setItem('moonplayer_ui_mode', 'riff'));
  await p.goto('http://localhost:7644/index.html', { waitUntil: 'domcontentloaded' });
  await sleep(3500);

  // Patch MoonPlayer to trace calls
  await p.evaluate(() => {
    const orig_set = window.MoonPlayer.setCustomBackground;
    const orig_get = window.MoonPlayer.getCustomBackground;
    window.MoonPlayer.setCustomBackground = async function(file) {
      console.log('[TRACE] setCustomBackground called, file.size=', file.size, 'type=', file.type);
      try {
        const r = await orig_set(file);
        console.log('[TRACE] setCustomBackground OK, result type=', typeof r);
        return r;
      } catch (e) { console.log('[TRACE] setCustomBackground THREW:', e.message); throw e; }
    };
    window.MoonPlayer.getCustomBackground = async function() {
      const r = await orig_get();
      console.log('[TRACE] getCustomBackground returned:', r ? `Blob size=${r.size}` : 'null');
      return r;
    };
  });

  const check = async (label) => {
    return p.evaluate(() => {
      const layer = document.getElementById('riff-custom-bg');
      const cs = layer ? getComputedStyle(layer) : {};
      const mc = document.getElementById('main-content');
      const mcCs = mc ? getComputedStyle(mc) : {};
      return {
        bodyClass: document.body.className,
        layerStyle: layer ? layer.style.cssText : 'missing',
        layerOpacity: cs.opacity,
        layerDisplay: cs.display,
        layerZ: cs.zIndex,
        mainBg: mcCs.backgroundColor,
        riffBgObjUrl: window.__riffBgObjectUrl || (window.riffBgObjectUrl || 'unknown'),
      };
    });
  };

  console.log('=== INITIAL ===');
  console.log(JSON.stringify(await check('initial')));

  // Upload red
  const input1 = await p.$('#riff-bg-file');
  console.log('\n=== UPLOADING RED ===');
  await input1.uploadFile(red);
  await sleep(3000);
  console.log(JSON.stringify(await check('after red')));
  await p.screenshot({ path: 'test_screenshots/diag_after_red.png' });

  // Upload green (change)
  const input2 = await p.$('#riff-bg-file');
  console.log('\n=== UPLOADING GREEN ===');
  await input2.uploadFile(green);
  await sleep(3000);
  console.log(JSON.stringify(await check('after green')));
  await p.screenshot({ path: 'test_screenshots/diag_after_green.png' });

  console.log('\n=== CONSOLE TRACE ===');
  consoleLines.filter(l => l.includes('[TRACE]') || l.includes('background') || l.includes('ERR')).forEach(l => console.log(l));
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(2); });
