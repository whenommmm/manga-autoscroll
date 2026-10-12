const test = require('node:test');
const assert = require('node:assert/strict');
const { toggleInTab, CONTENT_FILES } = require('../src/background.js');

// A fake chrome.scripting that runs injected functions against a fake page.
function fakeTab() {
  const page = { injections: 0, toggles: 0 };
  globalThis.window = {};
  const scripting = {
    async executeScript({ target, func, files }) {
      assert.equal(typeof target.tabId, 'number');
      await new Promise((resolve) => setImmediate(resolve)); // real calls are async
      if (files) {
        assert.deepEqual(files, CONTENT_FILES);
        page.injections++;
        window.__mangaScroll = { toggle: () => page.toggles++ };
        return [{ result: null }];
      }
      return [{ result: func() }];
    },
  };
  return { page, scripting };
}

test.afterEach(() => {
  delete globalThis.window;
});

test('content scripts load dependencies first and content.js last', () => {
  assert.deepEqual(CONTENT_FILES, [
    'src/scroll-target.js',
    'src/scroller.js',
    'src/badge.js',
    'src/keys.js',
    'src/content.js',
  ]);
});

test('the first press injects the content scripts', async () => {
  const { page, scripting } = fakeTab();
  await toggleInTab(1, scripting);
  assert.equal(page.injections, 1);
  assert.equal(page.toggles, 0);
});

test('later presses toggle instead of injecting again', async () => {
  const { page, scripting } = fakeTab();
  await toggleInTab(1, scripting);
  await toggleInTab(1, scripting);
  await toggleInTab(1, scripting);
  assert.equal(page.injections, 1);
  assert.equal(page.toggles, 2);
});

test('a double press while injecting does not inject twice', async () => {
  const { page, scripting } = fakeTab();
  await Promise.all([toggleInTab(1, scripting), toggleInTab(1, scripting)]);
  assert.equal(page.injections, 1);
  assert.equal(page.toggles, 0);
});

test('pages the extension may not touch are skipped quietly', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const scripting = {
    executeScript: async () => {
      throw new Error('Cannot access a chrome:// URL');
    },
  };
  await toggleInTab(1, scripting); // must not throw
  await toggleInTab(1, scripting); // and must not stay locked
  assert.equal(warn.mock.callCount(), 2);
});
