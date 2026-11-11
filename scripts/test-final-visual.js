// Final visual proof: Trending tab with a track actually playing + search view.
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:7644';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(() => localStorage.setItem('moonplayer_ui_mode', 'riff'));
  await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await sleep(3500);
  await p.evaluate(() => window.RiffUI && window.RiffUI.switchView('soundcloud'));
  await sleep(4500);

  // Click the 2nd trending track and let it play
  const info = await p.evaluate(async () => {
    const rows = document.querySelectorAll('#sc-tracks-list .track-row');
    const row = rows[1];
    const title = row.querySelector('.track-row-title').textContent;
    row.click();
    await new Promise(r => setTimeout(r, 4000));
    const a = document.getElementById('bg-audio');
    return { title, paused: a.paused, t: a.currentTime, ready: a.readyState };
  });
  console.log('PLAYING:', JSON.stringify(info));
  await p.screenshot({ path: 'test_screenshots/final_playing.png' });

  // Search view screenshot
  await p.evaluate(() => {
    const inp = document.getElementById('riff-search-input');
    inp.value = 'daft punk';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(6000);
  const searchRows = await p.evaluate(() => document.querySelectorAll('#search-tracks-list .track-row').length);
  console.log('SEARCH rows:', searchRows);
  await p.screenshot({ path: 'test_screenshots/final_search.png' });
  await b.close();
  process.exit((!info.paused && info.t > 0 && searchRows > 0) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
