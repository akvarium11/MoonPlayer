// Regression: playback from a dynamically-paged liked track + all 3 tabs.
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 900 });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.evaluateOnNewDocument(() => localStorage.setItem('moonplayer_ui_mode', 'riff'));
  await p.goto('http://localhost:7644/index.html', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await p.evaluate(() => window.RiffUI.switchView('soundcloud'));
  await sleep(3000);

  const tabs = {};
  for (const t of ['trending', 'likes', 'all']) {
    await p.evaluate(x => { const el = document.querySelector(`.sc-subtab[data-sctab="${x}"]`); if (el) el.click(); }, t);
    await sleep(4500);
    tabs[t] = await p.evaluate(() => document.querySelectorAll('#sc-tracks-list .track-row').length);
  }
  console.log('TABS:', JSON.stringify(tabs));

  // page likes then click a late (paged-in) row
  await p.evaluate(() => { const el = document.querySelector('.sc-subtab[data-sctab="likes"]'); if (el) el.click(); });
  await sleep(4000);
  for (let i = 0; i < 2; i++) {
    await p.evaluate(() => { const mc = document.getElementById('main-content'); if (mc) { mc.scrollTop = mc.scrollHeight; mc.dispatchEvent(new Event('scroll', { bubbles: true })); } });
    await sleep(3500);
  }
  const play = await p.evaluate(async () => {
    const rows = document.querySelectorAll('#sc-tracks-list .track-row');
    const row = rows[rows.length - 3] || rows[rows.length - 1];
    if (!row) return { ok: false };
    const title = row.querySelector('.track-row-title').textContent;
    row.click();
    const a = document.getElementById('bg-audio');
    const t0 = Date.now();
    while (Date.now() - t0 < 10000) { await new Promise(r => setTimeout(r, 400)); if (a.readyState >= 2 && !a.paused && a.currentTime > 0.05) break; }
    return { title, paused: a.paused, ready: a.readyState, t: a.currentTime, totalRows: rows.length,
      current: window.MoonPlayer.getCurrentSong() ? window.MoonPlayer.getCurrentSong().title : null };
  });
  console.log('PAGED PLAYBACK:', JSON.stringify(play));
  console.log('Errors:', errs.length ? JSON.stringify(errs) : 'none');
  await b.close();
  const ok = Object.values(tabs).every(n => n > 0) && play.current && !play.paused && play.t > 0;
  console.log('VERDICT:', ok ? 'PASS' : 'FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
