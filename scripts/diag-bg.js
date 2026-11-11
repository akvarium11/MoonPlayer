const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1200, height: 800 });
  await p.evaluateOnNewDocument(() => localStorage.setItem('moonplayer_ui_mode', 'riff'));
  await p.goto('http://localhost:7644/index.html', { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  const info = await p.evaluate(async (b64) => {
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await window.MoonPlayer.setCustomBackground(new File([arr], 'b.png', { type: 'image/png' }));
    // manually refresh the riff layer through the same code path as upload
    const el = document.getElementById('riff-bg-file');
    // call internal refresh by dispatching change again is complex; do direct layer set
    const blob = await window.MoonPlayer.getCustomBackground();
    const layer = document.getElementById('riff-custom-bg');
    layer.style.backgroundImage = `url("${URL.createObjectURL(blob)}")`;
    document.body.classList.add('riff-custom-bg-on');
    document.documentElement.classList.add('riff-custom-bg-on');

    const stack = [];
    let node = document.elementFromPoint(600, 400);
    const at = node;
    while (node && stack.length < 12) {
      const cs = getComputedStyle(node);
      stack.push({
        tag: node.tagName, id: node.id, cls: String(node.className).slice(0, 50),
        bg: cs.backgroundColor, bgImg: cs.backgroundImage.slice(0, 40),
        pos: cs.position, z: cs.zIndex, op: cs.opacity
      });
      node = node.parentElement;
    }
    const layerRect = layer.getBoundingClientRect();
    return {
      topElement: at ? at.tagName + '#' + at.id : 'none',
      layerStyle: layer.getAttribute('style'),
      layerRect: JSON.stringify(layerRect),
      layerParentId: layer.parentElement ? layer.parentElement.id : 'none',
      stack
    };
  }, 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR42mP8z8Dwn4GBgYGJAQoACgED/g8hYWYAAAAASUVORK5CYII=');
  console.log(JSON.stringify(info, null, 1));
  await b.close();
})().catch(e => console.error(e));
