import fs from 'node:fs';
import { spawn } from 'node:child_process';

const OUT = 'F:/fzz-Project/03-solo/audit/shots';
const CDP = 9335;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'file:///F:/fzz-Project/03-solo/solo-web-v2/index.html';
const profile = process.env.TEMP + '/sect-' + Date.now();

const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port='+CDP,'--remote-allow-origins=*','--user-data-dir='+profile,'--hide-scrollbars','about:blank'], { stdio: 'ignore' });
async function jget(u){ return (await fetch(u)).json(); }
let list=null;
for(let i=0;i<80;i++){ try{ list=await jget(`http://127.0.0.1:${CDP}/json/list`); if(list&&list.length) break; }catch(e){} await new Promise(r=>setTimeout(r,250)); }
const ws=new WebSocket((list.find(t=>t.type==='page')||list[0]).webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let seq=0; const pending=new Map();
ws.onmessage=ev=>{const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){const {res,rej}=pending.get(m.id);pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result);}};
const send=(method,params={})=>new Promise((res,rej)=>{const i=++seq;pending.set(i,{res,rej});ws.send(JSON.stringify({id:i,method,params}));});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await send('Page.enable');

async function shot(name){ const r=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(`${OUT}/${name}.png`,Buffer.from(r.data,'base64')); console.log('saved',name); }
async function go(sel){ await send('Runtime.evaluate',{expression:`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(e) e.scrollIntoView({block:'start'}); })()`}); await sleep(1100); }

await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:URL}); await sleep(2800);
await go('#fonts');  await shot('sec-fonts');
await go('#features'); await shot('sec-features');
await go('#safety'); await shot('sec-safety');
await go('footer');  await shot('sec-footer');
// 弹窗
await send('Runtime.evaluate',{expression:`document.querySelector('[data-qr-open]').click()`}); await sleep(700);
await shot('sec-modal');
await send('Runtime.evaluate',{expression:`document.querySelector('[data-qr-close]') && document.querySelector('[data-qr-close]').click()`}); await sleep(300);

// 暗色
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
await send('Page.reload'); await sleep(2600);
await go('#fonts');  await shot('sec-fonts-dark');
await go('footer');  await shot('sec-footer-dark');

// 移动端
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'light'}]});
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await send('Page.reload'); await sleep(2400);
await go('#features'); await shot('sec-m-features');
await go('footer'); await shot('sec-m-footer');
await send('Runtime.evaluate',{expression:`document.querySelector('[data-qr-open]').click()`}); await sleep(600);
await shot('sec-m-modal');

try{ws.close();}catch(e){}
try{chrome.kill();}catch(e){}
process.exit(0);
