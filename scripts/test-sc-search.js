// Test SoundCloud-mode search (Riff UI platform=soundcloud) + track 404s
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:7644';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const failed = [];
  page.on('requestfailed', r => failed.push('FAILED ' + r.url().slice(0, 100)));
  page.on('response', r => { if (r.status() >= 400) failed.push(r.status() + ' ' + r.url().slice(0, 120)); });

  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 3000));
  await page.evaluate(() => {
    document.documentElement.classList.add('mode-riff');
    document.body.classList.add('mode-riff');
    // force soundcloud platform the way the platform button does
    const scBtn = document.getElementById('platform-btn-soundcloud');
    if (scBtn) scBtn.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  const platform = await page.evaluate(() => window.RiffUI ? (window.RiffUI.getState ? window.RiffUI.getState().platform : 'n/a') : 'no RiffUI');
  console.log('platform state:', platform);

  const search = await page.evaluate(async () => {
    const inp = document.getElementById('riff-search-input');
    if (!inp) return { ok: false, reason: 'no input' };
    inp.value = 'daft punk';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 8000));
    const list = document.getElementById('search-tracks-list');
    return {
      rows: list ? list.querySelectorAll('.track-row').length : -1,
      subtitle: (document.getElementById('search-view-subtitle') || {}).textContent || '',
      first: list && list.querySelector('.track-row-title') ? list.querySelector('.track-row-title').textContent : null
    };
  });
  console.log('SC search:', JSON.stringify(search));

  // Verify a streamed track actually returns audio bytes (206/200)
  const track = await page.evaluate(async () => {
    const t = await window.MoonPlayer.fetchSoundCloudFeed('trending');
    return t[0] ? { id: t[0].id, src: t[0].src } : null;
  });
  let streamStatus = 'n/a';
  if (track) {
    const resp = await page.goto(BASE + track.src, { waitUntil: 'domcontentloaded' }).catch(e => null);
    // use fetch in page instead
    streamStatus = await page.evaluate(async (src) => {
      try { const r = await fetch(src, { headers: { Range: 'bytes=0-1023' } }); return r.status + ' type=' + r.headers.get('content-type'); }
      catch (e) { return 'ERR ' + e.message; }
    }, track.src).catch(() => 'eval-failed');
  }
  console.log('Stream status:', streamStatus);

  console.log('Failed/4xx requests:', JSON.stringify(failed.slice(0, 15)));
  await browser.close();
  process.exit(search.rows > 0 ? 0 : 1);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
