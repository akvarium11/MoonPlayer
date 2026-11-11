// Verify a paged-in liked track streams with enough time to buffer.
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 900 });
  await p.evaluateOnNewDocument(() => localStorage.setItem('moonplayer_ui_mode', 'riff'));
  await p.goto('http://localhost:7644/index.html', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await p.evaluate(() => window.RiffUI.switchView('soundcloud'));
  await sleep(3000);
  await p.evaluate(() => { const el = document.querySelector('.sc-subtab[data-sctab="likes"]'); if (el) el.click(); });
  await sleep(4000);
  for (let i = 0; i < 2; i++) {
    await p.evaluate(() => { const mc = document.getElementById('main-content'); if (mc) { mc.scrollTop = mc.scrollHeight; mc.dispatchEvent(new Event('scroll', { bubbles: true })); } });
    await sleep(3500);
  }
  const r = await p.evaluate(async () => {
    const rows = document.querySelectorAll('#sc-tracks-list .track-row');
    const row = rows[rows.length - 3];
    const title = row.querySelector('.track-row-title').textContent;
    row.click();
    const a = document.getElementById('bg-audio');
    const t0 = Date.now();
    let last = {};
    while (Date.now() - t0 < 20000) {
      await new Promise(r => setTimeout(r, 500));
      last = { paused: a.paused, ready: a.readyState, t: a.currentTime, err: a.error ? a.error.code : null, src: a.src.slice(-40), net: a.networkState };
      if (a.readyState >= 2 && !a.paused && a.currentTime > 0.1) break;
    }
    return { title, rows: rows.length, ...last };
  });
  console.log(JSON.stringify(r));
  await b.close();
  process.exit((r.t > 0 && !r.paused) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
