// Browser smoke test: loads the unpacked extension, mounts every tool, exercises a few flows,
// and fails on page errors. Needs `npm i -D puppeteer-core` and a Chromium that honours
// --load-extension (Edge or Chrome for Testing; branded Google Chrome ignores it).
//
//   BROWSER="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" node test/smoke.mjs
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const EXT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BROWSER = process.env.BROWSER;
if (!BROWSER) {
  console.error('Set BROWSER to a Chromium executable path (Edge or Chrome for Testing).');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: 'new',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run', '--no-default-browser-check'],
});

const problems = [];
try {
  const worker = await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 15000 });
  const extId = new URL(worker.url()).host;
  const url = (path) => `chrome-extension://${extId}/${path}`;

  const page = await browser.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('ERR_FILE_NOT_FOUND')) problems.push(`[console] ${msg.text()}`); });
  page.on('pageerror', (err) => problems.push(`[pageerror] ${err.message}`));
  page.on('dialog', (d) => d.dismiss());

  const tools = ['links', 'markdown', 'json', 'encode', 'jwt', 'regex', 'timestamp', 'uuid', 'hash', 'color', 'text'];
  for (const tool of tools) {
    await page.goto(url(`src/workbench/workbench.html#${tool}`), { waitUntil: 'load', timeout: 15000 });
    await sleep(400);
    const info = await page.evaluate(() => ({
      toolId: document.querySelector('.tool')?.dataset.tool,
      children: document.querySelector('.tool-body')?.children.length,
    }));
    console.log(tool.padEnd(10), JSON.stringify(info));
    if (info.toolId !== tool || !info.children) problems.push(`[mount] ${tool} did not render`);
  }

  // JSON: beautify and error position
  await page.goto(url('src/workbench/workbench.html#json'), { waitUntil: 'load' });
  await page.waitForSelector('textarea');
  await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    ta.value = '{"b":1,"a":[1,2,{"c":null}]}';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.$eval('.toolbar .btn-primary', (b) => b.click());
  const jsonOut = await page.$eval('pre.output', (n) => n.textContent);
  if (!jsonOut.includes('\n  "b": 1')) problems.push('[json] beautify output unexpected');
  await page.evaluate(() => {
    const ta = document.querySelector('textarea');
    ta.value = '{"a": 1,}';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  const jsonErr = await page.$eval('.status', (n) => n.textContent);
  if (!/line \d+, col \d+/.test(jsonErr)) problems.push('[json] error position missing: ' + jsonErr);

  // Markdown: renders and sanitizes
  await page.goto(url('src/workbench/workbench.html#markdown'), { waitUntil: 'load' });
  await sleep(300);
  await page.evaluate(() => {
    const ta = document.querySelector('.md-editor-wrap textarea');
    ta.value = '# X\n\n<img src=x onerror="window.__pwned=1">\n\n<script>window.__pwned=2</script>';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  const pwned = await page.evaluate(() => window.__pwned);
  const mdHtml = await page.$eval('.md-body', (n) => n.innerHTML);
  if (!mdHtml.includes('<h1') || pwned || /onerror|<script/.test(mdHtml)) problems.push('[markdown] render/sanitize failed: ' + mdHtml);

  // Links: add via form, then popup lists it
  await page.goto(url('src/workbench/workbench.html#links'), { waitUntil: 'load' });
  await sleep(300);
  await page.type('input[type=url]', 'https://developer.mozilla.org/en-US/docs/Web');
  await page.type('input[placeholder^="tags"]', 'docs, web');
  await page.$eval('form .btn-primary', (b) => b.click());
  await sleep(400);
  const cards = await page.$$eval('.link-card', (ns) => ns.length);
  if (!cards) problems.push('[links] adding a link failed');

  // Markdown viewer content script on a local .md file
  const md = await browser.newPage();
  md.on('pageerror', (err) => problems.push(`[md-viewer] ${err.message}`));
  await md.goto('file:///' + resolve(EXT, 'test/fixtures/sample.md').replace(/\\/g, '/'), { waitUntil: 'load' });
  await sleep(600);
  const view = await md.evaluate(() => ({
    active: document.body.classList.contains('md-viewer'),
    toc: document.querySelectorAll('.md-toc a').length,
    pwned: window.__pwned,
  }));
  if (!view.active || view.toc !== 4 || view.pwned) problems.push('[md-viewer] unexpected: ' + JSON.stringify(view));

  const popup = await browser.newPage();
  popup.on('pageerror', (err) => problems.push(`[popup] ${err.message}`));
  await popup.goto(url('src/popup/popup.html'), { waitUntil: 'load' });
  await sleep(400);
  const items = await popup.$$eval('.link-item', (ns) => ns.length);
  if (!items) problems.push('[popup] no links listed');
} catch (err) {
  problems.push('[fatal] ' + err.stack);
} finally {
  await browser.close();
}

console.log(problems.length ? `\n${problems.length} problem(s):` : '\nOK');
for (const p of problems) console.log('  ' + p);
process.exit(problems.length ? 1 : 0);
