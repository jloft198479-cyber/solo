import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';

import { SITE_ROOT as ROOT, CHROME } from './paths.mjs';

const PORT = 8099;
const CDP = 9333;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('nf'); return;
  }
  const ext = path.extname(file).toLowerCase();
  const buf = fs.readFileSync(file);
  const ae = req.headers['accept-encoding'] || '';
  const compressible = ['.html', '.css', '.js', '.svg', '.xml', '.txt'].includes(ext);
  if (/gzip/.test(ae) && compressible) {
    const gz = zlib.gzipSync(buf, { level: 9 });
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=3600' });
    res.end(gz);
  } else {
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
    res.end(buf);
  }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP || '.', 'audit-' + Date.now());
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=' + CDP, '--remote-allow-origins=*',
  '--user-data-dir=' + profile, '--window-size=1440,900', '--hide-scrollbars', 'about:blank'
], { stdio: 'ignore' });

async function jget(u) { const r = await fetch(u); return r.json(); }
let list = null;
for (let i = 0; i < 80; i++) {
  try { list = await jget(`http://127.0.0.1:${CDP}/json/list`); if (list && list.length) break; } catch (e) {}
  await new Promise(r => setTimeout(r, 250));
}
if (!list) { console.log(JSON.stringify({ fatal: 'chrome did not start' })); server.close(); process.exit(1); }
const target = list.find(t => t.type === 'page') || list[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
const errors = [];
const reqs = new Map();
const byType = {};
let totalBytes = 0;
const loadWaiters = [];

function onEvent(m) {
  if (m.method === 'Page.loadEventFired') loadWaiters.splice(0).forEach(f => f());
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push('EXC: ' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
  }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    errors.push(m.params.type.toUpperCase() + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Log.entryAdded' && (m.params.entry.level === 'error' || m.params.entry.level === 'warning')) {
    errors.push('LOG ' + m.params.entry.level + ': ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  }
  if (m.method === 'Network.requestWillBeSent') {
    reqs.set(m.params.requestId, { url: m.params.request.url, type: m.params.type });
  }
  if (m.method === 'Network.responseReceived') {
    const r = reqs.get(m.params.requestId);
    if (r) { r.status = m.params.response.status; r.mime = m.params.response.mimeType; }
  }
  if (m.method === 'Network.loadingFinished') {
    const r = reqs.get(m.params.requestId);
    if (r) { r.bytes = m.params.encodedDataLength; totalBytes += m.params.encodedDataLength; byType[r.type] = (byType[r.type] || 0) + 1; }
  }
}
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id); pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  } else onEvent(m);
};
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const i = ++seq; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
async function waitLoad(ms = 25000) {
  const p = new Promise(r => loadWaiters.push(r));
  await Promise.race([p, new Promise(r => setTimeout(r, ms))]);
}

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Network.enable'); await send('Performance.enable');
await send('Emulation.setCPUThrottlingRate', { rate: 4 });
await send('Network.emulateNetworkConditions', {
  offline: false, latency: 150,
  downloadThroughput: 1.6 * 1024 * 1024 / 8,
  uploadThroughput: 675 * 1024 / 8
});
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__audit={lcp:0,cls:0,fcp:0,longTasks:[],shifts:0};
    try{
      new PerformanceObserver(l=>{for(const e of l.getEntries())window.__audit.lcp=Math.round(e.startTime)}).observe({type:'largest-contentful-paint',buffered:true});
      new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput){window.__audit.cls+=e.value;window.__audit.shifts++}}).observe({type:'layout-shift',buffered:true});
      new PerformanceObserver(l=>{for(const e of l.getEntries())if(e.name==='first-contentful-paint')window.__audit.fcp=Math.round(e.startTime)}).observe({type:'paint',buffered:true});
      new PerformanceObserver(l=>{for(const e of l.getEntries())window.__audit.longTasks.push(Math.round(e.duration))}).observe({type:'longtask',buffered:true});
    }catch(e){}
    window.__errs=[];
    window.addEventListener('error',e=>window.__errs.push(String(e.message)));
    window.addEventListener('unhandledrejection',e=>window.__errs.push('unhandled:'+String(e.reason)));
  `
});

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await waitLoad();
await new Promise(r => setTimeout(r, 4500));

async function evalJSON(expr, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
      if (r && r.result && typeof r.result.value === 'string') return JSON.parse(r.result.value);
      console.error('[' + label + '] no value, raw=' + JSON.stringify(r).slice(0, 300));
    } catch (e) {
      console.error('[' + label + '] ' + e.message);
    }
    await new Promise(r => setTimeout(r, 800));
  }
  return null;
}

const pageData = await evalJSON(`JSON.stringify({
    a: window.__audit || {},
    errs: window.__errs || [],
    nav: (()=>{const n=performance.getEntriesByType('navigation')[0]||{};return {dcl:Math.round(n.domContentLoadedEventEnd||0),load:Math.round(n.loadEventEnd||0),ttfb:Math.round(n.responseStart||0)}})(),
    dom: document.getElementsByTagName('*').length,
    imgs: [...document.querySelectorAll('img')].map(i=>({f:i.currentSrc.split('/').pop(),nw:i.naturalWidth,nh:i.naturalHeight,ok:i.complete}))
  })`, 'desktop') || { a: {}, errs: [], nav: {}, dom: 0, imgs: [] };

const perfRaw = await send('Performance.getMetrics');
const perf = {};
perfRaw.metrics.forEach(m => { perf[m.name] = m.value; });

// ---- 移动端 pass ----
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setCPUThrottlingRate', { rate: 1 });
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await send('Page.reload', { ignoreCache: true });
await waitLoad(20000);
await new Promise(r => setTimeout(r, 2500));

const mobile = await evalJSON(`JSON.stringify({
    winW: window.innerWidth,
    scrollW: document.documentElement.scrollWidth,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
    targets: [...document.querySelectorAll('header a, header button, footer a, .hero a, .hero button, .btn, [data-qr-open]')].map(el=>{
      const r=el.getBoundingClientRect(); const s=getComputedStyle(el);
      if(r.width===0||r.height===0||s.display==='none'||s.visibility==='hidden') return null;
      return {t:(el.textContent||'').trim().slice(0,16)||el.getAttribute('aria-label')||el.className, w:Math.round(r.width), h:Math.round(r.height)};
    }).filter(Boolean),
    tinyFonts: [...document.querySelectorAll('p,li,span,a')].map(el=>{
      const s=getComputedStyle(el); const r=el.getBoundingClientRect();
      if(!el.textContent.trim()||r.height===0||r.width===0) return null;
      const fs=Math.round(parseFloat(s.fontSize)*10)/10;
      return fs<12?{t:el.textContent.trim().slice(0,14),fs}:null;
    }).filter(Boolean).slice(0,25),
    headerH: Math.round((document.querySelector('.site-header')||document.body).getBoundingClientRect().height)
  })`, 'mobile') || { winW: 390, scrollW: 0, overflowX: -1, targets: [], tinyFonts: [], headerH: 0 };

const out = {
  perf: {
    fcp: pageData.a.fcp, lcp: pageData.a.lcp, cls: Math.round((pageData.a.cls || 0) * 1000) / 1000,
    shifts: pageData.a.shifts, longTasks: pageData.a.longTasks,
    ttfb: pageData.nav.ttfb, domContentLoaded: pageData.nav.dcl, load: pageData.nav.load,
    taskDuration: Math.round(perf.TaskDuration * 1000), scriptDuration: Math.round(perf.ScriptDuration * 1000),
    layoutDuration: Math.round(perf.LayoutDuration * 1000), styleRecalc: Math.round(perf.RecalcStyleDuration * 1000),
    jsHeapKB: Math.round(perf.JSHeapUsedSize / 1024), nodes: perf.Nodes,
    requests: reqs.size, transferKB: Math.round(totalBytes / 1024), byType
  },
  errors: [...new Set(errors)].slice(0, 30),
  pageErrs: [...new Set(pageData.errs)].slice(0, 20),
  domNodes: pageData.dom,
  imagesBroken: pageData.imgs.filter(i => !i.ok || !i.nw),
  mobile
};
console.log(JSON.stringify(out, null, 2));

try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
server.close();
setTimeout(() => process.exit(0), 300);
