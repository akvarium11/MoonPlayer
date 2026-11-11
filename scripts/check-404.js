const puppeteer = require('puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage();
  p.on('response', r => { if (r.status() >= 400) console.log(r.status(), r.url()); });
  await p.goto('http://localhost:7644/index.html', { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 3000));
  await b.close();
})().catch(e => console.error(e));
