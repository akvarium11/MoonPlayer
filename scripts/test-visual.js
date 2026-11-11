// Visual test: real Riff UI activation, SoundCloud tabs, screenshot per tab.
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:7644';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 160)); });

  // Force Riff UI before scripts run.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('moonplayer_ui_mode', 'riff');
  });

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
  await sleep(4000);

  const init = await page.evaluate(() => ({
    mode: window.MoonPlayer ? window.MoonPlayer.getUIMode() : 'no bridge',
    riffClass: document.body.classList.contains('mode-riff') || document.documentElement.classList.contains('mode-riff'),
    hasRiffUI: typeof window.RiffUI !== 'undefined',
    viewSoundcloud: !!document.getElementById('view-soundcloud')
  }));
  console.log('Init:', JSON.stringify(init));

  // Switch to the SoundCloud view through the real controller.
  await page.evaluate(() => {
    if (window.RiffUI) window.RiffUI.switchView('soundcloud');
  });
  await sleep(5000);

  const results = {};
  for (const tab of ['trending', 'likes', 'all']) {
    await page.evaluate((t) => {
      const b = document.querySelector(`.sc-subtab[data-sctab="${t}"]`);
      if (b) b.click();
    }, tab);
    await sleep(4500);
    const info = await page.evaluate(() => {
      const list = document.getElementById('sc-tracks-list');
      const visible = list ? Array.from(list.querySelectorAll('.track-row')).filter(r => {
        const rect = r.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).length : 0;
      return {
        rows: list ? list.querySelectorAll('.track-row').length : -1,
        visible,
        subtitle: (document.getElementById('sc-subtitle') || {}).textContent || '',
        viewActive: (document.getElementById('view-soundcloud') || {}).className || ''
      };
    });
    results[tab] = info;
    console.log(`Tab [${tab}]:`, JSON.stringify(info));
    await page.screenshot({ path: `test_screenshots/sc_${tab}.png`, fullPage: false });
  }

  console.log('Errors:', errs.length ? JSON.stringify(errs.slice(0, 10)) : 'none');
  const ok = Object.values(results).every(r => r.rows > 0 && r.visible > 0);
  console.log('VISUAL VERDICT:', ok ? 'PASS (rows visible)' : 'FAIL');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
