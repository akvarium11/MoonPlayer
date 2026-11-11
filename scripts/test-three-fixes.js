// Visual + functional test for: spinner animation, red background, likes paging.
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:7644';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--window-size=1400,900'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1400, height: 900 });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text().slice(0, 140)); });
  await p.evaluateOnNewDocument(() => localStorage.setItem('moonplayer_ui_mode', 'riff'));
  await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await sleep(3500);

  // --- 1. Spinner animation actually running on a loading state ---
  const spin = await p.evaluate(() => {
    const test = document.createElement('div');
    test.style.cssText = 'width:28px;height:28px;border:3px solid #f50;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;';
    document.body.appendChild(test);
    const cs = getComputedStyle(test);
    const r = { name: cs.animationName, duration: cs.animationDuration, iteration: cs.animationIterationCount };
    // sample transform twice to confirm it changes (animation running)
    const t1 = getComputedStyle(test).transform;
    return new Promise(resolve => setTimeout(() => {
      const t2 = getComputedStyle(test).transform;
      test.remove();
      resolve({ ...r, t1, t2, animating: t1 !== t2 });
    }, 200));
  });
  console.log('SPINNER:', JSON.stringify(spin));

  // --- 2. Red background via real file input ---
  const input = await p.$('#riff-bg-file');
  await input.uploadFile(require('path').join(__dirname, '..', 'test_screenshots', '_red_bg.png'));
  await sleep(2500);
  const bg = await p.evaluate(() => {
    const layer = document.getElementById('riff-custom-bg');
    const mc = document.getElementById('main-content');
    return {
      layerBg: layer.style.backgroundImage.slice(0, 55),
      layerOpacity: getComputedStyle(layer).opacity,
      mainBg: getComputedStyle(mc).backgroundColor,
      bodyOn: document.body.classList.contains('riff-custom-bg-on')
    };
  });
  console.log('BACKGROUND:', JSON.stringify(bg));
  await p.screenshot({ path: 'test_screenshots/red_bg.png' });

  // --- 3. Likes paging: switch to SoundCloud -> likes, scroll to bottom ---
  await p.evaluate(() => window.RiffUI && window.RiffUI.switchView('soundcloud'));
  await sleep(3000);
  await p.evaluate(() => { const btn = document.querySelector('.sc-subtab[data-sctab="likes"]'); if (btn) btn.click(); });
  await sleep(5000);
  const before = await p.evaluate(() => ({
    rows: document.querySelectorAll('#sc-tracks-list .track-row').length,
    next: window.RiffUI.getState().scFeedNext.likes ? 'yes' : 'no'
  }));
  console.log('LIKES before scroll:', JSON.stringify(before));

  // scroll main-content to bottom, twice, to trigger paging
  for (let i = 0; i < 3; i++) {
    await p.evaluate(() => {
      const mc = document.getElementById('main-content');
      if (mc) { mc.scrollTop = mc.scrollHeight; mc.dispatchEvent(new Event('scroll', { bubbles: true })); }
      const rr = document.getElementById('riff-root');
      if (rr) { rr.scrollTop = rr.scrollHeight; rr.dispatchEvent(new Event('scroll', { bubbles: true })); }
    });
    await sleep(3500);
  }
  const after = await p.evaluate(() => ({
    rows: document.querySelectorAll('#sc-tracks-list .track-row').length,
    subtitle: (document.getElementById('sc-subtitle') || {}).textContent || '',
    next: window.RiffUI.getState().scFeedNext.likes ? 'yes' : 'no'
  }));
  console.log('LIKES after scroll:', JSON.stringify(after));
  await p.screenshot({ path: 'test_screenshots/likes_paged.png' });

  console.log('Errors:', errs.length ? JSON.stringify(errs.slice(0, 8)) : 'none');
  await b.close();
  const ok = spin.animating && bg.bodyOn && after.rows > before.rows;
  console.log('VERDICT:', ok ? 'PASS' : 'CHECK');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
