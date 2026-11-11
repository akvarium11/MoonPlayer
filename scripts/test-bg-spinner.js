// Test: custom background change in Riff UI + spinner keyframes + likes paging
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:7644';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--window-size=1440,900'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 160)); });
  await p.evaluateOnNewDocument(() => localStorage.setItem('moonplayer_ui_mode', 'riff'));
  await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await sleep(3500);

  // --- 1. Spinner: is @keyframes spin defined? ---
  const spin = await p.evaluate(() => {
    let found = false;
    for (const ss of document.styleSheets) {
      try { for (const r of ss.cssRules) { if (r.type === CSSRule.KEYFRAMES_RULE && r.name === 'spin') found = true; } } catch (e) {}
    }
    return { keyframesDefined: found, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches };
  });
  console.log('SPINNER:', JSON.stringify(spin));

  // --- 2. Background: create a real PNG file and feed it to #riff-bg-file ---
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoACgED/g8hYWYAAAAASUVORK5CYII=', 'base64');
  const tmp = path.join(__dirname, '..', 'test_screenshots', '_bgtest.png');
  fs.writeFileSync(tmp, png);
  const input = await p.$('#riff-bg-file');
  console.log('file input found:', !!input);
  if (input) {
    await input.uploadFile(tmp);
    await sleep(2500);
  }
  const bg = await p.evaluate(() => {
    const layer = document.getElementById('riff-custom-bg');
    const cs = layer ? getComputedStyle(layer) : null;
    const classic = document.getElementById('custom-bg');
    const classicCs = classic ? getComputedStyle(classic) : null;
    return {
      afterImg: layer ? layer.style.backgroundImage.slice(0, 70) : 'none',
      bodyHasClass: document.body.classList.contains('riff-custom-bg-on'),
      htmlHasClass: document.documentElement.classList.contains('riff-custom-bg-on'),
      layerOpacity: cs ? cs.opacity : 'n/a',
      layerDisplay: cs ? cs.display : 'n/a',
      layerZ: cs ? cs.zIndex : 'n/a',
      layerVisible: cs ? (cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0) : false,
      classicDisplay: classicCs ? classicCs.display : 'n/a',
      status: (document.getElementById('riff-bg-status') || {}).textContent || ''
    };
  });
  console.log('BACKGROUND:', JSON.stringify(bg));
  await p.screenshot({ path: 'test_screenshots/bg_test.png' });
  console.log('Errors:', errs.length ? JSON.stringify(errs.slice(0, 8)) : 'none');
  await b.close();
})().catch(e => { console.error('CRASH', e); process.exit(2); });
