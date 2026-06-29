const { JSDOM } = require('jsdom');
const domino = new JSDOM('<!DOCTYPE html>');
globalThis.document = domino.window.document;
globalThis.window = domino.window;
globalThis.Node = domino.window.Node;
globalThis.navigator = domino.window.navigator;
globalThis.getComputedStyle = () => ({});

const md = '**「hello world」** is great';

// Use markdown-it directly
const markdownit = require('markdown-it');
const mdParser = markdownit({ html: true });

const tokens = mdParser.parse(md, {});
console.log('Tokens:');
tokens.forEach((t, i) => {
  if (t.type !== 'text') {
    console.log(`  [${i}] ${t.type} level=${t.level} tag=${t.tag} nesting=${t.nesting}`);
    if (t.type === 'inline') {
      t.children?.forEach((c, j) => {
        console.log(`    child[${j}] ${c.type} tag=${c.tag} content=${JSON.stringify(c.content)}`);
      });
    }
  }
});
