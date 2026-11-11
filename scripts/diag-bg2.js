const puppeteer = require('puppeteer-core');
const fs = require('fs'); const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 800 });
  await p.evaluateOnNewDocument(() => localStorage.setItem('moonplayer_ui_mode', 'riff'));
  await p.goto('http://localhost:7644/index.html', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoACgED/g8hYWYAAAAASUVORK5CYII=', 'base64');
  const tmp = path.join(__dirname, '..', 'test_screenshots', '_bg2.png');
  fs.writeFileSync(tmp, png);
  const input = await p.$('#riff-bg-file');
  await input.uploadFile(tmp);
  await sleep(2500);
  const info = await p.evaluate(() => {
    const mc = document.getElementById('main-content');
    const cs = getComputedStyle(mc);
    const layer = document.getElementById('riff-custom-bg');
    return {
      bodyClass: document.body.className,
      htmlClass: document.documentElement.className,
      mainBg: cs.backgroundColor,
      mainBgImportant: cs.getPropertyPriority('background-color'),
      layerBg: layer.style.backgroundImage.slice(0, 60),
      layerOpacity: getComputedStyle(layer).opacity,
      matchedRules: (() => {
        const out = [];
        for (const ss of document.styleSheets) {
          try { for (const r of ss.cssRules) {
            if (r.selectorText && /main-content/.test(r.selectorText) && r.style && r.style.background) {
              try { if (mc.matches(r.selectorText)) out.push(r.selectorText + ' => ' + r.style.background); } catch (e) {}
            }
          } } catch (e) {}
        }
        return out;
      })()
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await b.close();
})().catch(e => console.error(e));
