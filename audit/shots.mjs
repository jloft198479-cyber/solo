import fs from 'node:fs';
import { spawn } from 'node:child_process';

const OUT = 'F:/fzz-Project/03-solo/audit/shots';
fs.mkdirSync(OUT, { recursive: true });
const CDP = 9334;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///F:/fzz-Project/03-solo/solo-web-v2/index.html';
const profile = process.env.TEMP + '/shots-' + Date.now();

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + CDP, '--remote-allow-origins=*',
  '--user-data-dir=' + profile, '--hide-scrollbars', '--allow-file-access-from-files', 'about:blank'
], { stdio: 'ignore' });

async function jget(u) { return (await fetch(u)).json(); }
let list = null;
for (let i = 0; i < 80; i++) {
  try { list = await jget(`http://127.0.0.1:${CDP}/json/list`); if (list && list.length) break; } catch (e) {}
  await new Promise(r => setTimeout(r, 250));
}
const ws = new WebSocket((list.find(t => t.type === 'page') || list[0]).webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++seq; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await send('Page.navigate', { url: URL }); await sleep(3000);

async function shot(name, opts = {}) {
  const r = await send('Page.captureScreenshot', { format: 'png', ...opts });
  fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log('saved', name);
}
async function fullHeight() {
  const m = await send('Page.getLayoutMetrics');
  return Math.ceil(m.cssContentSize.height);
}

// 桌面亮色：首屏 + 整页
await shot('desktop-hero');
const dh = await fullHeight();
await shot('desktop-full', { clip: { x: 0, y: 0, width: 1440, height: Math.min(dh, 13000), scale: 0.5 }, captureBeyondViewport: true });

// 桌面暗色首屏
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await send('Page.reload'); await sleep(2500);
await shot('desktop-hero-dark');

// 移动端亮色
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.reload'); await sleep(2500);
await shot('mobile-hero');
const mh = await fullHeight();
await shot('mobile-full', { clip: { x: 0, y: 0, width: 390, height: Math.min(mh, 20000), scale: 0.5 }, captureBeyondViewport: true });

// 移动端暗色
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await send('Page.reload'); await sleep(2000);
await shot('mobile-hero-dark');

// 320px 极窄屏横向溢出检查
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 720, deviceScaleFactor: 2, mobile: true });
await send('Page.reload'); await sleep(1800);
const narrow = await send('Runtime.evaluate', {
  expression: `JSON.stringify({w:innerWidth,scrollW:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth-innerWidth,bodyW:document.body.getBoundingClientRect().width})`,
  returnByValue: true
});
console.log('320px:', narrow.result.value);

try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
process.exit(0);
