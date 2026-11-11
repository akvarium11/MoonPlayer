// Visual + functional test for MoonPlayer riff UI (SoundCloud tabs, playback, search)
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:7644';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,900', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200));
  });

  const log = (...a) => console.log(...a);

  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3500)); // let UI init + server health settle

  // Check the bridge exists
  const hasBridge = await page.evaluate(() => typeof window.MoonPlayer !== 'undefined' && typeof window.MoonPlayer.fetchSoundCloudFeed === 'function');
  log('Bridge fetchSoundCloudFeed:', hasBridge ? 'OK' : 'MISSING');

  // Switch to Riff UI mode if needed
  await page.evaluate(() => {
    document.documentElement.classList.add('mode-riff');
    document.body.classList.add('mode-riff');
  });

  // Directly drive the SoundCloud view through the bridge + DOM the way the UI does
  const feed = {};
  for (const tab of ['trending', 'likes', 'all']) {
    const res = await page.evaluate(async (t) => {
      try {
        const tracks = await window.MoonPlayer.fetchSoundCloudFeed(t);
        return { ok: true, count: tracks.length, sample: tracks.slice(0, 2).map(x => ({ id: x.id, title: x.title, src: x.src, gi: x.globalIndex })) };
      } catch (e) { return { ok: false, error: e.message }; }
    }, tab);
    feed[tab] = res;
    log(`Feed [${tab}]:`, JSON.stringify(res));
  }

  // Now render the actual view and count visible rows
  const tabResults = {};
  for (const tab of ['trending', 'likes', 'all']) {
    // click the subtab button
    await page.evaluate((t) => {
      const btn = document.querySelector(`.sc-subtab[data-sctab="${t}"]`);
      if (btn) btn.click();
    }, tab);
    await new Promise(r => setTimeout(r, 4000));
    const rows = await page.evaluate(() => {
      const list = document.getElementById('sc-tracks-list');
      return {
        count: list ? list.querySelectorAll('.track-row').length : -1,
        subtitle: (document.getElementById('sc-subtitle') || {}).textContent || '',
        firstTitle: list && list.querySelector('.track-row-title') ? list.querySelector('.track-row-title').textContent : null,
        html: list ? list.innerHTML.slice(0, 120) : null
      };
    });
    tabResults[tab] = rows;
    log(`View [${tab}]:`, JSON.stringify(rows));
  }

  // Playback test: click first row in trending and check audio src + isPlaying
  await page.evaluate(() => {
    const btn = document.querySelector('.sc-subtab[data-sctab="trending"]');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 3500));
  const playResult = await page.evaluate(async () => {
    const list = document.getElementById('sc-tracks-list');
    const row = list && list.querySelector('.track-row');
    if (!row) return { ok: false, reason: 'no row to click' };
    row.click();
    await new Promise(r => setTimeout(r, 2500));
    const audio = document.getElementById('bg-audio');
    return {
      ok: true,
      src: audio ? audio.src : null,
      paused: audio ? audio.paused : null,
      readyState: audio ? audio.readyState : null,
      currentSong: window.MoonPlayer.getCurrentSong() ? window.MoonPlayer.getCurrentSong().title : null
    };
  });
  log('Playback:', JSON.stringify(playResult));

  // Search test (SoundCloud)
  const searchResult = await page.evaluate(async () => {
    const inp = document.getElementById('riff-search-input');
    if (!inp) return { ok: false, reason: 'search input missing' };
    inp.value = 'test';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 6000));
    const list = document.getElementById('search-tracks-list');
    return {
      ok: true,
      rows: list ? list.querySelectorAll('.track-row').length : -1,
      subtitle: (document.getElementById('search-view-subtitle') || {}).textContent || ''
    };
  });
  log('Search:', JSON.stringify(searchResult));

  // Screenshot
  await page.screenshot({ path: 'test_screenshots/soundcloud_tabs.png', fullPage: false });

  log('Errors:', errors.length ? JSON.stringify(errors.slice(0, 12)) : 'none');

  // Verdict
  const feedsOK = Object.values(feed).every(f => f.ok && f.count > 0);
  const viewsOK = Object.values(tabResults).every(v => v.count > 0);
  const playOK = playResult.ok && playResult.currentSong;
  const searchOK = searchResult.ok && searchResult.rows > 0;
  log('VERDICT:', JSON.stringify({ feedsOK, viewsOK, playOK, searchOK }));

  await browser.close();
  process.exit((feedsOK && viewsOK && playOK && searchOK) ? 0 : 1);
})().catch(e => { console.error('TEST CRASH:', e); process.exit(2); });
