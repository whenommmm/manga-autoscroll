// Browser smoke test. Opens test/reader.html in headless Google Chrome, injects
// the content scripts the way background.js does (with chrome.storage stubbed
// to a saved speed of 200), and checks what unit tests cannot: real scrolling,
// the badge, key handling and cleanup. Not part of `node --test`: it needs Chrome.
//
// Run: node test/browser-smoke.js
// Set CHROME_PATH to use another Chromium-based browser binary.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CONTENT_FILES } = require('../src/background.js');

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = path.join(__dirname, '..');
const SCREENSHOT = path.join(os.tmpdir(), 'manga-autoscroll-smoke.png');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function devtoolsPort(profileDir) {
  const file = path.join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(file)) {
      const port = fs.readFileSync(file, 'utf8').split('\n')[0].trim();
      if (port) return port;
    }
    await sleep(100);
  }
  throw new Error(`Chrome did not start (no ${file})`);
}

async function connect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const pending = new Map();
  let nextId = 1;
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  return {
    send,
    async evaluate(expression) {
      const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      }
      return result.result.value;
    },
    close: () => ws.close(),
  };
}

const failures = [];
function check(name, ok, got) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);
  if (!ok) failures.push(name);
}

const READ = {
  badge: `document.querySelector('manga-scroll-badge')?.shadowRoot.querySelector('.pill').textContent ?? null`,
  boxTop: `document.getElementById('reader').scrollTop`,
  pageTop: `document.scrollingElement.scrollTop`,
  snap: `getComputedStyle(document.getElementById('reader')).scrollSnapType`,
  log: `document.getElementById('log').textContent`,
};
const press = (key, on = 'document.body') =>
  `${on}.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true })); true`;

async function injectContentScripts(page) {
  await page.evaluate(`Object.defineProperty(window, 'chrome', { configurable: true, value: {
    storage: { local: { get: async () => ({ speed: 200 }), set: async () => {} } },
  } }); true`);
  for (const file of CONTENT_FILES) {
    await page.evaluate(fs.readFileSync(path.join(ROOT, file), 'utf8') + '\n;true');
  }
}

async function loadLazyReader(page, url) {
  await page.send('Page.navigate', { url: `${url}?lazy` });
  await sleep(800);
  await injectContentScripts(page);
}

// Readers whose images have no height yet when Alt+S is pressed: at first only
// the page itself (by its 160 px footer) can scroll, so that is what gets picked.
async function runLazy(page, url) {
  await loadLazyReader(page, url);
  await sleep(4500); // scroll the 160 px page, then the 3 s end wait
  const badge = await page.evaluate(READ.badge);
  check('with nothing loaded yet, it scrolls the page and ends', badge === '■ End', badge);
  await page.evaluate(`growPages(); true`);
  await page.evaluate(`window.__mangaScroll.toggle(); true`); // what background.js runs on Alt+S
  await sleep(1000);
  let top = await page.evaluate(READ.boxTop);
  check('Alt+S after the pages load scrolls the strip', top > 100, top);

  await loadLazyReader(page, url);
  await sleep(300);
  await page.evaluate(`growPages(); true`);
  await sleep(5000); // page end + 3 s end wait, then it should find the strip by itself
  top = await page.evaluate(READ.boxTop);
  check('pages that load after Alt+S still get scrolled', top > 100, top);
}

async function run(page) {
  await injectContentScripts(page);
  await sleep(300);

  let badge = await page.evaluate(READ.badge);
  check('badge shows the saved speed', badge === '▶︎ 200', badge);
  const start = await page.evaluate(READ.boxTop);
  await sleep(1000);
  const moved = (await page.evaluate(READ.boxTop)) - start;
  check('the strip box scrolls at about 200 px/s', moved >= 150 && moved <= 260, moved);
  const pageTop = await page.evaluate(READ.pageTop);
  check('the page itself does not scroll', pageTop === 0, pageTop);
  const snap = await page.evaluate(READ.snap);
  check('scroll snapping is off while active', snap === 'none', snap);

  await page.evaluate(`document.getElementById('typing').focus(); true`);
  await page.evaluate(press(' ', `document.getElementById('typing')`));
  badge = await page.evaluate(READ.badge);
  check('Space typed in a text box does not pause', badge.startsWith('▶'), badge);
  await page.evaluate(`document.activeElement.blur(); true`);

  await page.evaluate(press(' '));
  badge = await page.evaluate(READ.badge);
  check('Space pauses', badge === '❚❚ 200', badge);
  const log = await page.evaluate(READ.log);
  check('the site Space handler did not run', log === '', log);
  const pausedAt = await page.evaluate(READ.boxTop);
  await sleep(500);
  const pausedNow = await page.evaluate(READ.boxTop);
  check('nothing moves while paused', pausedNow === pausedAt, pausedNow - pausedAt);

  await page.evaluate(press('='));
  badge = await page.evaluate(READ.badge);
  check('= speeds up', badge === '❚❚ 210', badge);
  await page.evaluate(press(' '));
  badge = await page.evaluate(READ.badge);
  check('Space resumes', badge === '▶︎ 210', badge);

  await page.evaluate(`document.getElementById('reader').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true })); true`);
  let heldAt = await page.evaluate(READ.boxTop);
  await sleep(1000);
  let heldNow = await page.evaluate(READ.boxTop);
  check('a wheel event holds scrolling', Math.abs(heldNow - heldAt) <= 1, heldNow - heldAt);
  await sleep(1000);
  let after = await page.evaluate(READ.boxTop);
  check('scrolling resumes after the hold', after > heldNow + 50, after - heldNow);

  await page.evaluate(`document.getElementById('reader').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); true`);
  heldAt = await page.evaluate(READ.boxTop);
  await sleep(1000);
  heldNow = await page.evaluate(READ.boxTop);
  await sleep(1000);
  after = await page.evaluate(READ.boxTop);
  check('a pointer press with no release still resumes', Math.abs(heldNow - heldAt) <= 1 && after > heldNow + 50, [heldNow - heldAt, after - heldNow]);

  await page.evaluate(`const r = document.getElementById('reader'); r.scrollTo({ top: r.scrollHeight, behavior: 'instant' }); true`);
  await sleep(3800);
  badge = await page.evaluate(READ.badge);
  check('it stops at the end and says so', badge === '■ End', badge);
  const shot = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(SCREENSHOT, Buffer.from(shot.result.data, 'base64'));

  await page.evaluate(`document.getElementById('next').click(); true`);
  await page.evaluate(`window.__mangaScroll.toggle(); true`); // what background.js runs on Alt+S
  await sleep(1000);
  const newTop = await page.evaluate(READ.boxTop);
  check('after an in-page chapter change, Alt+S scrolls the new box', newTop > 100, newTop);

  await page.evaluate(press('Escape'));
  badge = await page.evaluate(READ.badge);
  check('Esc removes the badge', badge === null, badge);
  const gone = await page.evaluate(`window.__mangaScroll === undefined`);
  check('Esc removes the controller', gone === true, gone);
  const snapAfter = await page.evaluate(READ.snap);
  check('Esc restores scroll snapping', snapAfter.includes('mandatory'), snapAfter);
  await sleep(600); // let the restored snap settle
  const offAt = await page.evaluate(READ.boxTop);
  await sleep(500);
  const offNow = await page.evaluate(READ.boxTop);
  check('nothing moves after Esc', offNow === offAt, offNow - offAt);
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error(`Chrome not found at ${CHROME}. Set CHROME_PATH.`);
    process.exit(2);
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'manga-smoke-'));
  const url = pathToFileURL(path.join(ROOT, 'test', 'reader.html')).href;
  const browser = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--window-size=1000,800',
      '--no-first-run',
      '--no-default-browser-check',
      url,
    ],
    { stdio: 'ignore' },
  );
  let page;
  try {
    page = await connect(await devtoolsPort(profile));
    await sleep(500); // let the page build its strip
    await run(page);
    await runLazy(page, url);
  } finally {
    page?.close();
    if (browser.exitCode === null && browser.signalCode === null) {
      const exited = new Promise((resolve) => browser.once('exit', resolve));
      browser.kill();
      await exited;
    }
    try {
      // Chrome's helper processes can still be flushing files right after exit.
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (err) {
      console.warn(`Could not remove temp profile ${profile}: ${err.message}`);
    }
  }
  console.log(`\nScreenshot: ${SCREENSHOT}`);
  console.log(failures.length ? `${failures.length} check(s) failed` : 'All checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
