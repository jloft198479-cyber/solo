import fs from 'node:fs';
import { INDEX_HTML, OG_PNG } from './paths.mjs';
const h = fs.readFileSync(INDEX_HTML, 'utf8');

const ids = [...h.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const dupIds = ids.filter((v, i) => ids.indexOf(v) !== i);

const hrefs = [...h.matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
const missingAnchors = [...new Set(hrefs.filter(a => !ids.includes(a)))];

const imgs = [...h.matchAll(/<img\b[^>]*>/g)].map(m => m[0]);
const imgNoAlt = imgs.filter(t => !/\balt=/.test(t)).length;
const imgEmptyAlt = imgs.filter(t => /\balt=""/.test(t)).length;

const buttons = [...h.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
const btnNoName = buttons.filter(([, attrs, inner]) =>
  !/aria-label=/.test(attrs) && inner.replace(/<[^>]+>/g, '').trim() === ''
).length;

const blank = [...h.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map(m => m[0]);
const blankNoRel = blank.filter(t => !/rel="[^"]*noopener/.test(t)).length;

const nodeIdCount = (h.match(/data-page-node-id=/g) || []).length;
const nodeIdBytes = [...h.matchAll(/\s*data-page-node-id="[^"]*"/g)].reduce((a, m) => a + Buffer.byteLength(m[0]), 0);

const h1 = (h.match(/<h1\b/g) || []).length;
const levels = [...h.matchAll(/<h([1-6])\b/g)].map(m => +m[1]);
let jumps = 0;
for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) jumps++;

const inlineStyle = (h.match(/\sstyle="[^"]*"/g) || []).length;
const httpInsecure = (h.match(/http:\/\//g) || []).length;

const title = (h.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '';
const desc = (h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';

const png = fs.readFileSync(OG_PNG).subarray(0, 33);
const ogW = png.readUInt32BE(16), ogH = png.readUInt32BE(20);

console.log(JSON.stringify({
  ids: ids.length, dupIds, missingAnchors,
  imgs: imgs.length, imgNoAlt, imgEmptyAlt,
  buttons: buttons.length, btnNoName,
  blankLinks: blank.length, blankNoRel,
  nodeIdCount, nodeIdBytesKB: Math.round(nodeIdBytes / 1024 * 10) / 10,
  h1, headingCount: levels.length, headingJumps: jumps,
  inlineStyleAttrs: inlineStyle,
  httpInsecure,
  titleLen: title.length, title,
  descLen: desc.length,
  ogSize: ogW + 'x' + ogH
}, null, 2));
