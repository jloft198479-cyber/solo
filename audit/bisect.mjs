import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';

const ROOT = path.resolve('F:/fzz-Project/03-solo/solo-web-v2');
const PORT = 8100, CDP = 9335;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const RATE = Number(process.env.RATE || 4);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  const ext = path.extname(file).toLowerCase(); const buf = fs.readFileSync(file);
  if (/gzip/.test(req.headers['accept-encoding'] || '') && ['.html', '.css', '.js', '.svg', '.xml', '.txt'].includes(ext)) {
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Encoding': 'gzip' }); res.end(zlib.gzipSync(buf, { level: 9 }));
  } else { res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' }); res.end(buf); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const profile = process.env.PROFILE || path.join(process.env.TEMP || '.', 'bis-' + Date.now());
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + CDP, '--remote-allow-origins=*', '--user-data-dir=' + profile, '--window-size=390,844', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let list = null;
for (let i = 0; i < 80; i++) { try { list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); if (list?.length) break; } catch (e) {} await new Promise(r => setTimeout(r, 250)); }
const target = list.find(t => t.type === 'page') || list[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0; const pending = new Map(); let loaded = false;
ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } if (m.method === 'Page.loadEventFired') loaded = true; };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++seq; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setCPUThrottlingRate', { rate: RATE });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
for (let i = 0; i < 60 && !loaded; i++) await new Promise(r => setTimeout(r, 250));
await new Promise(r => setTimeout(r, 2500));

const expr = `(()=>{
  document.body.offsetHeight;
  const secs=[...document.querySelectorAll('main > section')];
  const out=[];
  for(let i=secs.length-1;i>=0;i--){
    const s=secs[i];
    const h=Math.round(s.getBoundingClientRect().height);
    const t0=performance.now();
    s.remove();
    void document.body.offsetHeight;
    const t1=performance.now();
    out.push({i, id:s.id||'(no id)', h, ms:Math.round(t1-t0)});
  }
  const total=out.reduce((a,b)=>a+b.ms,0);
  return JSON.stringify({rate:${RATE}, total:Math.round(total), parts:out.reverse()});
})()`;

const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
const data = JSON.parse(r.result.value);
console.log(`降速 ${data.rate}x ｜ 逐段删除后触发的布局成本合计 ${data.total}ms`);
console.log('段序'.padEnd(4) + 'id'.padEnd(16) + '高度'.padEnd(8) + '移除此段省下');
for (const p of data.parts) console.log(String(p.i).padEnd(4) + p.id.padEnd(16) + String(p.h + 'px').padEnd(8) + p.ms + 'ms');

try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
server.close();
setTimeout(() => process.exit(0), 300);
