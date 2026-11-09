import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';

const ROOT = path.resolve('F:/fzz-Project/03-solo/solo-web-v2');
const PORT = 8099;
const CDP = 9334;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MODE = process.argv[2] || 'load';          // load | scroll
const VARIANT = process.argv[3] || 'base';       // base | noblur

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };

const OV = {
  base: '',
  nowrap: 'h1,h2,h3,h4{text-wrap:normal!important}p,li,span,div{text-wrap:wrap!important}',
  nobalance: 'h1,h2,h3,h4{text-wrap:normal!important}',
  nopretty: 'p,li{text-wrap:wrap!important}',
  noblur: '.site-header{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}',
  noanim: '*,*::before,*::after{transition:none!important;animation:none!important}',
  cv: 'main>section{content-visibility:auto;contain-intrinsic-size:auto 1200px}'
};
const OVERRIDE = OV[VARIANT];
if (OVERRIDE === undefined) { console.error('unknown variant ' + VARIANT); process.exit(1); }

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  const ext = path.extname(file).toLowerCase();
  let buf = fs.readFileSync(file);
  if (OVERRIDE && ext === '.css') buf = Buffer.concat([buf, Buffer.from('\n' + OVERRIDE, 'utf8')]);
  const ae = req.headers['accept-encoding'] || '';
  if (/gzip/.test(ae) && ['.html', '.css', '.js', '.svg', '.xml', '.txt'].includes(ext)) {
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Content-Encoding': 'gzip', 'Cache-Control': 'no-store' });
    res.end(zlib.gzipSync(buf, { level: 9 }));
  } else {
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const profile = process.env.PROFILE || path.join(process.env.TEMP || '.', 'jank-' + Date.now());
const RATE = Number(process.env.RATE || 4);
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + CDP, '--remote-allow-origins=*', '--user-data-dir=' + profile, '--window-size=390,844', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

let list = null;
for (let i = 0; i < 80; i++) {
  try { list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); if (list && list.length) break; } catch (e) {}
  await new Promise(r => setTimeout(r, 250));
}
if (!list) { console.log(JSON.stringify({ fatal: 'chrome did not start' })); server.close(); process.exit(1); }
const target = list.find(t => t.type === 'page') || list[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
let traceBuf = [];
let loadWaiters = [];
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); return; }
  if (m.method === 'Page.loadEventFired') loadWaiters.splice(0).forEach(f => f());
  if (m.method === 'Tracing.dataCollected' && Array.isArray(m.params.value)) traceBuf.push(...m.params.value);
};
function send(method, params = {}) { return new Promise((res, rej) => { const i = ++seq; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); }
async function waitLoad(ms = 25000) { const p = new Promise(r => loadWaiters.push(r)); await Promise.race([p, new Promise(r => setTimeout(r, ms))]); }
async function evalJSON(expr, label) {
  for (let a = 0; a < 3; a++) {
    try { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r?.result?.value) return JSON.parse(r.result.value); } catch (e) { console.error('[' + label + '] ' + e.message); }
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setCPUThrottlingRate', { rate: RATE });
await send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8, uploadThroughput: 675 * 1024 / 8 });

const injected = `
  window.__loaf=[];
  try{
    new PerformanceObserver(l=>{for(const e of l.getEntries()){
      window.__loaf.push({start:Math.round(e.startTime),dur:Math.round(e.duration),renderStart:Math.round(e.renderStart||0),slStart:Math.round(e.styleAndLayoutStart||0),blocking:Math.round(e.blockingDuration||0),
        scripts:(e.scripts||[]).map(s=>({inv:s.invoker||'',type:s.invokerType||'',fn:s.sourceFunctionName||'',src:(s.sourceURL||'').split('/').pop(),dur:Math.round(s.duration||0),forced:Math.round(s.forcedStyleAndLayoutDuration||0)}))});
    }}).observe({type:'long-animation-frame',buffered:true});
  }catch(e){}
  window.__lt=[];
  try{
    new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push({dur:Math.round(e.duration),name:e.name,attr:(e.attribution||[]).map(a=>a.containerType+':'+(a.containerName||a.containerSrc||'')).join('|')})}).observe({type:'longtask',buffered:true});
  }catch(e){}
  window.__frames=[];
  (function tick(t){ window.__frames.push(Math.round(t)); requestAnimationFrame(tick); })(0);
`;
await send('Page.addScriptToEvaluateOnNewDocument', { source: injected });

await send('Tracing.start', { categories: 'devtools.timeline,v8.execute,blink.user_timing', options: 'sampling-frequency=10000', transferMode: 'ReportEvents' });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
await waitLoad();
await new Promise(r => setTimeout(r, 3500));

let scrollStats = null;
if (MODE === 'scroll') {
  scrollStats = await evalJSON(`(async()=>{
    const H=document.documentElement.scrollHeight;
    window.__frames.length=0; window.__loaf.length=0; window.__lt.length=0;
    const step=Math.round(window.innerHeight*0.6); let y=0; const t0=performance.now();
    while(y < H - window.innerHeight && performance.now()-t0 < 20000){
      y+=step; window.scrollTo(0,y);
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    }
    await new Promise(r=>setTimeout(r,600));
    const f=window.__frames; const gaps=[];
    for(let i=1;i<f.length;i++) gaps.push(f[i]-f[i-1]);
    gaps.sort((a,b)=>b-a);
    return JSON.stringify({scrollH:H, steps:Math.round(y/step), frames:f.length, duration:Math.round(performance.now()-t0),
      worstGaps:gaps.slice(0,8), over32:gaps.filter(g=>g>32).length, over100:gaps.filter(g=>g>100).length,
      longTasks:window.__lt, loaf:window.__loaf});
  })()`, 'scroll');
}

const loaf = await evalJSON(`JSON.stringify({loaf:window.__loaf, longTasks:window.__lt, frames:window.__frames.length})`, 'loaf') || {};
const stats = await evalJSON(`JSON.stringify({
  nodes: document.getElementsByTagName('*').length,
  chars: (document.body.innerText||'').length,
  height: document.documentElement.scrollHeight,
  width: window.innerWidth,
  imgs: document.images.length,
  sections: document.querySelectorAll('main > section').length
})`, 'stats') || {};
await send('Tracing.end');
await new Promise(r => setTimeout(r, 1200));
if (process.env.DUMP) fs.writeFileSync(path.join('F:/fzz-Project/03-solo/audit', 'trace-' + VARIANT + '.json'), JSON.stringify(traceBuf));

const NAMES = new Set(['Layout', 'UpdateLayoutTree', 'Paint', 'PrePaint', 'Layerize', 'Commit', 'CompositeLayers', 'ParseHTML', 'EvaluateScript', 'v8.run', 'FunctionCall', 'TimerFire', 'EventDispatch', 'HitTest', 'UpdateLayer', 'RasterTask', 'Decode Image', 'ImageDecodeTask', 'FireAnimationFrame', 'ParseAuthorStyleSheet', 'ScheduleStyleRecalculation', 'InvalidateLayout', 'LayoutShift', 'RecalculateStyles']);
const agg = new Map();
let dirtyTop = new Map();
let minT = Infinity;
for (const e of traceBuf) {
  if (e.ph !== 'X' || typeof e.dur !== 'number') continue;
  if (e.ts / 1000 < minT) minT = e.ts / 1000;
  if (!NAMES.has(e.name)) continue;
  const k = e.name;
  const cur = agg.get(k) || { n: 0, dur: 0, max: 0 };
  cur.n++; cur.dur += e.dur / 1000; cur.max = Math.max(cur.max, e.dur / 1000);
  agg.set(k, cur);
  if (e.name === 'Layout') {
    const d = e.args?.beginData;
    if (Array.isArray(d?.dirtyObjects)) {
      for (const o of d.dirtyObjects) { const nm = o.nodeName || '?'; dirtyTop.set(nm, (dirtyTop.get(nm) || 0) + 1); }
    } else if (d && typeof d.dirtyObjects === 'number') {
      dirtyTop.set('(count only)', (dirtyTop.get('(count only)') || 0) + d.dirtyObjects);
    }
  }
}
const table = [...agg.entries()].map(([k, v]) => ({ name: k, count: v.n, totalMs: Math.round(v.dur), maxMs: Math.round(v.max * 10) / 10 })).sort((a, b) => b.totalMs - a.totalMs).slice(0, 14);
const dirty = [...dirtyTop.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

const out = {
  mode: MODE, variant: VARIANT,
  loaf: (loaf.loaf || []).map(l => ({ ...l, renderRatio: l.dur ? Math.round(((l.slStart ? l.start + l.dur - l.slStart : l.start + l.dur - l.renderStart) / l.dur) * 100) : 0, jsMs: l.slStart ? l.slStart - l.start : l.renderStart - l.start })),
  longTasks: loaf.longTasks || [],
  scroll: scrollStats,
  stats,
  traceTop: table,
  dirtyNodes: dirty,
  totalTraceEvents: traceBuf.length
};
console.log(JSON.stringify(out, null, 2));

try { ws.close(); } catch (e) {}
try { chrome.kill(); } catch (e) {}
server.close();
setTimeout(() => process.exit(0), 300);
