import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';

const ROOT = path.resolve('F:/fzz-Project/03-solo/solo-web-v2');
const ALT = path.resolve('F:/fzz-Project/03-solo/audit');
const PORT = 8101, CDP = 9336;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const RATE = Number(process.env.RATE || 4);
const LOADS = Number(process.env.LOADS || 3);
const PAGE = process.env.PAGE || 'index.html';
const OVNAME = process.env.OV || '';
const OV_MAP = {
  nowrap: 'h1,h2,h3,h4{text-wrap:normal!important}p,li,span,div{text-wrap:wrap!important}',
  nobalance: 'h1,h2,h3,h4{text-wrap:normal!important}',
  nopretty: 'p,li{text-wrap:wrap!important}',
  noblur: '.site-header{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
  nointer: 'body{font-family:"Segoe UI","Microsoft YaHei",sans-serif!important}'
};
const OV = OV_MAP[OVNAME] || '';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  let file = path.resolve(ROOT, '.' + p);
  if (!fs.existsSync(file)) file = path.resolve(ALT, '.' + p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  const ext = path.extname(file).toLowerCase(); let buf = fs.readFileSync(file);
  if (OV && ext === '.css') buf = Buffer.concat([buf, Buffer.from(String.fromCharCode(10) + OV, 'utf8')]);
  if (process.env.NOCSS && file.endsWith('styles.css')) buf = Buffer.from('/* stripped */', 'utf8');
  if (ext === '.html' && (process.env.NOIMG || process.env.NOJS || process.env.NOSVG)) {
    let h = buf.toString('utf8');
    if (process.env.NOIMG) h = h.replace(/<img[^>]*>/g, '');
    if (process.env.NOJS) h = h.replace(/<script[^>]*src="\.\/main\.js"[^>]*><\/script>/g, '');
    if (process.env.NOSVG) h = h.replace(/<svg[\s\S]*?<\/svg>/g, '');
    buf = Buffer.from(h, 'utf8');
  }
  if (/gzip/.test(req.headers['accept-encoding'] || '') && ['.html', '.css', '.js', '.svg', '.xml', '.txt'].includes(ext)) {
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Encoding': 'gzip' }); res.end(zlib.gzipSync(buf, { level: 9 }));
  } else { res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' }); res.end(buf); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP || '.', 'rep-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + CDP, '--remote-allow-origins=*', '--user-data-dir=' + profile, '--window-size=390,844', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let list = null;
for (let i = 0; i < 80; i++) { try { list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); if (list?.length) break; } catch (e) {} await new Promise(r => setTimeout(r, 250)); }
const ws = new WebSocket((list.find(t => t.type === 'page') || list[0]).webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); let buf = []; let loadWaiters = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method === 'Page.loadEventFired') loadWaiters.splice(0).forEach(f => f());
  if (m.method === 'Tracing.dataCollected' && Array.isArray(m.params.value)) buf.push(...m.params.value);
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++seq; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const waitLoad = async (ms = 30000) => { const p = new Promise(r => loadWaiters.push(r)); await Promise.race([p, new Promise(r => setTimeout(r, ms))]); };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setCPUThrottlingRate', { rate: RATE });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__loaf=[];try{new PerformanceObserver(l=>{for(const e of l.getEntries())window.__loaf.push({start:Math.round(e.startTime),dur:Math.round(e.duration),slStart:Math.round(e.styleAndLayoutStart||0),renderStart:Math.round(e.renderStart||0)})}).observe({type:'long-animation-frame',buffered:true})}catch(e){}`
});

const rows = [];
for (let n = 0; n < LOADS; n++) {
  buf = [];
  await send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
  if (n === 0) await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/${PAGE}` });
  else await send('Page.reload', { ignoreCache: false });
  await waitLoad();
  await new Promise(r => setTimeout(r, 2500));
  await send('Tracing.end');
  await new Promise(r => setTimeout(r, 900));
  const L = buf.filter(e => e.ph === 'X' && e.name === 'Layout' && typeof e.dur === 'number').map(e => ({ dur: Math.round(e.dur / 1000), dirty: e.args?.beginData?.dirtyObjects }));
  const loaf = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__loaf||[])', returnByValue: true });
  rows.push({ n: n + 1, layouts: L, loaf: JSON.parse(loaf.result.value || '[]') });
  await send('Runtime.evaluate', { expression: 'window.__loaf=[]' });
}

console.log(`CPU 降速 ${RATE}x ｜ 同一浏览器进程连续加载 ${LOADS} 次`);
for (const r of rows) {
  const tot = r.layouts.reduce((a, b) => a + b.dur, 0);
  const max = Math.max(0, ...r.layouts.map(l => l.dur));
  console.log(`第 ${r.n} 次：Layout ${r.layouts.length} 次，合计 ${tot}ms，最大 ${max}ms（dirty=${r.layouts.map(l => l.dirty).join(',')}）｜LoAF ${r.loaf.map(l => l.dur).join('+')}`);
}
try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
server.close();
setTimeout(() => process.exit(0), 300);
