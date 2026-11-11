// Strict playback test: wait until audio actually buffers and advances currentTime.
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:7644';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  await page.evaluateOnNewDocument(() => localStorage.setItem('moonplayer_ui_mode', 'riff'));
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await sleep(3500);
  await page.evaluate(() => window.RiffUI && window.RiffUI.switchView('soundcloud'));
  await sleep(4500);

  const result = await page.evaluate(async () => {
    const list = document.getElementById('sc-tracks-list');
    const rows = list ? list.querySelectorAll('.track-row') : [];
    if (!rows.length) return { ok: false, reason: 'no rows' };
    const row = rows[1]; // second track, likes/trending doesn't matter
    const title = row.querySelector('.track-row-title').textContent;
    row.click();
    const a = document.getElementById('bg-audio');
    // Wait up to 12s for buffering + playback progress
    const t0 = Date.now();
    let t1 = 0;
    while (Date.now() - t0 < 12000) {
      await new Promise(r => setTimeout(r, 400));
      if (a.readyState >= 2 && !a.paused) { t1 = a.currentTime; if (t1 > 0.05) break; }
    }
    return {
      title, src: a.src, paused: a.paused, readyState: a.readyState,
      currentTime: a.currentTime, duration: a.duration,
      current: window.MoonPlayer.getCurrentSong() ? window.MoonPlayer.getCurrentSong().title : null
    };
  });
  console.log('STRICT PLAYBACK:', JSON.stringify(result));
  await browser.close();
  const ok = result.ok !== false && !result.paused && result.currentTime > 0;
  console.log('VERDICT:', ok ? 'PASS (audio progressing)' : 'FAIL');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
