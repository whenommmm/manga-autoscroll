const test = require('node:test');
const assert = require('node:assert/strict');
const { findScrollTarget } = require('../src/scroll-target.js');

const VIEW = { innerWidth: 1000, innerHeight: 800 };
const ON_SCREEN = { top: 0, bottom: 800, left: 0, right: 1000 };

function box(name, { scrollHeight, clientHeight, overflowY = 'auto', rect = ON_SCREEN }) {
  return { name, scrollHeight, clientHeight, overflowY, getBoundingClientRect: () => rect };
}

function page(scrollingElement, elements) {
  return { scrollingElement, defaultView: VIEW, querySelectorAll: () => elements };
}

const getStyle = (el) => ({ overflowY: el.overflowY });
const flatDoc = () => box('document', { scrollHeight: 800, clientHeight: 800, overflowY: 'visible' });

test('a long scrolling document wins over a small scrolling box', () => {
  const doc = box('document', { scrollHeight: 20000, clientHeight: 800, overflowY: 'visible' });
  const comments = box('comments', { scrollHeight: 3000, clientHeight: 400 });
  assert.equal(findScrollTarget(page(doc, [comments]), getStyle).name, 'document');
});

test('the box that scrolls furthest wins', () => {
  const sidebar = box('sidebar', { scrollHeight: 4000, clientHeight: 800 });
  const strip = box('strip', { scrollHeight: 30000, clientHeight: 744 });
  assert.equal(findScrollTarget(page(flatDoc(), [sidebar, strip]), getStyle).name, 'strip');
});

test('a strip box beats a document that only scrolls a little', () => {
  const doc = box('document', { scrollHeight: 960, clientHeight: 800, overflowY: 'visible' });
  const strip = box('strip', { scrollHeight: 30000, clientHeight: 744 });
  assert.equal(findScrollTarget(page(doc, [strip]), getStyle).name, 'strip');
});

test('auto, scroll and overlay all count as scrollable', () => {
  for (const overflowY of ['auto', 'scroll', 'overlay']) {
    const strip = box('strip', { scrollHeight: 30000, clientHeight: 744, overflowY });
    assert.equal(findScrollTarget(page(flatDoc(), [strip]), getStyle).name, 'strip', overflowY);
  }
});

test('hidden, collapsed, barely-overflowing and off-screen boxes are ignored', () => {
  const hidden = box('hidden', { scrollHeight: 30000, clientHeight: 744, overflowY: 'hidden' });
  const collapsed = box('collapsed', { scrollHeight: 30000, clientHeight: 0 });
  const barely = box('barely', { scrollHeight: 790, clientHeight: 744 });
  const offscreen = box('offscreen', {
    scrollHeight: 30000,
    clientHeight: 744,
    rect: { top: 0, bottom: 800, left: -900, right: -100 },
  });
  const doc = page(flatDoc(), [hidden, collapsed, barely, offscreen]);
  assert.equal(findScrollTarget(doc, getStyle).name, 'document');
});

test('with nothing scrollable, the document is returned', () => {
  assert.equal(findScrollTarget(page(flatDoc(), []), getStyle).name, 'document');
});
