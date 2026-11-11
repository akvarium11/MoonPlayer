// Focused test: playback from Likes tab + classic UI search panel
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:7644';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await page.evaluate(() => { document.documentElement.classList.add('mode-riff'); document.body.classList.add('mode-riff'); });

  // --- Likes tab playback ---
  await page.evaluate(() => { const b = document.querySelector('.sc-subtab[data-sctab="likes"]'); if (b) b.click(); });
  await sleep(4500);
  const likesPlay = await page.evaluate(async () => {
    const list = document.getElementById('sc-tracks-list');
    const rows = list ? list.querySelectorAll('.track-row') : [];
    if (!rows.length) return { ok: false, reason: 'no rows' };
    // click the 3rd row to make sure it is not just the cached first track
    const row = rows[Math.min(2, rows.length - 1)];
    const title = row.querySelector('.track-row-title').textContent;
    row.click();
    await new Promise(r => setTimeout(r, 3000));
    const a = document.getElementById('bg-audio');
    return { title, src: a && a.src, paused: a && a.paused, readyState: a && a.readyState,
      current: window.MoonPlayer.getCurrentSong() ? window.MoonPlayer.getCurrentSong().title : null };
  });
  console.log('Likes playback:', JSON.stringify(likesPlay));

  // --- Classic UI search (script.js #search-input) ---
  const classic = await page.evaluate(async () => {
    const inp = document.getElementById('search-input');
    if (!inp) return { ok: false, reason: 'no #search-input' };
    inp.value = 'test';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2500));
    const res = document.getElementById('search-results');
    return { rows: res ? res.querySelectorAll('.result-item').length : -1 };
  });
  console.log('Classic search (local):', JSON.stringify(classic));

  // --- Classic UI SoundCloud search (searchType=soundcloud) ---
  const classicSc = await page.evaluate(async () => {
    // set search type to soundcloud via dropdown option
    const opt = document.querySelector('.dropdown-option[data-value="soundcloud"]');
    if (opt) opt.click();
    await new Promise(r => setTimeout(r, 300));
    const inp = document.getElementById('search-input');
    inp.value = 'daft punk';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 6000));
    const res = document.getElementById('search-results');
    return { rows: res ? res.querySelectorAll('.result-item').length : -1,
      html: res ? res.innerHTML.slice(0, 100) : null };
  });
  console.log('Classic search (SoundCloud):', JSON.stringify(classicSc));

  console.log('Pageerrors:', errs.length ? JSON.stringify(errs.slice(0, 6)) : 'none');
  await browser.close();
  process.exit((likesPlay.current && !likesPlay.paused) ? 0 : 1);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
