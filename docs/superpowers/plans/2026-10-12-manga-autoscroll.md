# Manga Auto-Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome-style (MV3) extension for Perplexity Comet that auto-scrolls long-strip manga at a steady, adjustable speed after one key press.

**Architecture:** A background service worker injects five classic content scripts into the current tab on `Alt+S` or a toolbar click (`activeTab` + `scripting`), or toggles them if they are already there. The pure logic (finding the scroll element, the scroll engine, key mapping, badge text) has no browser dependencies and is unit-tested in Node with fakes. `content.js` wires that logic to the real page. A headless-Chrome smoke test checks the real-DOM behavior.

**Tech Stack:** Plain JavaScript (no build step, no npm packages), Chrome Extension Manifest V3, Node built-in test runner (`node --test`), Chrome DevTools Protocol over Node's built-in `WebSocket` for the smoke test.

**Spec:** `docs/superpowers/specs/2026-10-12-manga-autoscroll-design.md`

## Global Constraints

- Manifest V3. Permissions exactly `activeTab`, `scripting`, `storage`. No `host_permissions`, no `content_scripts` key.
- No build step and no npm dependencies. All `src/` files are classic scripts, not ES modules.
- Every file in `src/` except `content.js` and `background.js` attaches its exports to `globalThis.MangaScroll` and also sets `module.exports` when `module` is defined.
- Tests run with `node --test test/` (Node 18+; this machine has Node v26.10.0).
- Speed in px/s: default `60`, step `10`, min `10`, max `400`. Stored in `chrome.storage.local` under key `speed`. Missing or invalid values fall back to `60`.
- Timings: hold after user input `1500` ms; wait at the bottom `3000` ms; frame gap cap `100` ms; drift tolerance `3` px; badge fades to opacity `0.15` after `2000` ms.
- Command name `toggle-scroll`, suggested key `Alt+S`.
- Badge text: `'▶︎ ' + speed` (running, holding, endWait), `'❚❚ ' + speed` (paused), `'■ End'` (ended). `︎` stops macOS drawing ▶ as an emoji.
- Content script injection order: `src/scroll-target.js`, `src/scroller.js`, `src/badge.js`, `src/keys.js`, `src/content.js`.
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Page scrolls a little and the strip scrolls in a box** (header or footer pushes the page 100–200 px past the viewport) → it must scroll the strip box, not the page. Pinned by `a strip box beats a document that only scrolls a little` (Task 1) and the smoke check `the page itself does not scroll` (Task 8).
2. **Reader loads the next chapter without a page load and replaces the scroll box** → `Alt+S` must start scrolling the new box, not keep showing `■ End` on the removed one. Pinned by the smoke check `after an in-page chapter change, Alt+S scrolls the new box` (Task 8).
3. **Alt+S pressed twice quickly, or shortcut plus icon click** → exactly one scroller in the tab. Pinned by `a double press while injecting does not inject twice` (Task 7).
4. **The site has its own Space or key handlers** → while active, Space, `=` and `-` must not reach the site's handlers. Pinned by the smoke check `the site Space handler did not run` (Task 8).
5. **Dragging the scrollbar** (Chrome often sends no `pointerup` after a scrollbar drag) → scrolling must not stay held forever; it resumes 1.5 s after the press. Pinned by the smoke check `a pointer press with no release still resumes` (Task 8). This is why `pointerdown` is plain user activity, not an indefinite hold.

---

## File Map

| File | Responsibility |
|---|---|
| `manifest.json` | MV3 manifest: permissions, service worker, command, icons |
| `src/background.js` | On `Alt+S` / icon click: inject content scripts or toggle the existing ones |
| `src/scroll-target.js` | `findScrollTarget(doc, getStyle)`: pick the element that scrolls the strip |
| `src/scroller.js` | `createScroller(...)`: the scroll engine state machine |
| `src/badge.js` | `badgeText(state, speed)` and `createBadge(doc)`: the corner pill |
| `src/keys.js` | `keyAction(event)`: map a keydown to an action or `null` |
| `src/content.js` | Wire everything to the page; expose `window.__mangaScroll = { toggle, off }` |
| `scripts/make-icons.js` | Generate `icons/icon{16,48,128}.png` with no dependencies |
| `test/*.test.js` | Unit tests (Node) |
| `test/reader.html` | Deliberately awkward fake long-strip reader |
| `test/browser-smoke.js` | Headless-Chrome smoke test (run separately; needs Chrome) |
| `README.md` | Install, keys, troubleshooting, manual checklist |

All commands below run from the repo root, `/Users/vanshsrivastava/manga-autoscroll`.

---

### Task 1: Scroll target finder

**Files:**
- Create: `src/scroll-target.js`
- Test: `test/scroll-target.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `findScrollTarget(doc, getStyle?) → Element`. `doc` needs `scrollingElement`, `defaultView.innerWidth/innerHeight`, `querySelectorAll('*')`. Elements need `scrollHeight`, `clientHeight`, `getBoundingClientRect()`. `getStyle(el)` returns an object with `overflowY`; it defaults to `doc.defaultView.getComputedStyle`.

Rule: the candidate that can scroll furthest (`scrollHeight - clientHeight`) wins. The document is the starting candidate and wins ties. A box must scroll more than 50 px, have `overflow-y` of `auto`, `scroll` or `overlay`, have `clientHeight > 0`, and be on screen.

- [ ] **Step 1: Write the failing test**

Create `test/scroll-target.test.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/scroll-target.test.js`
Expected: FAIL with `Cannot find module '../src/scroll-target.js'`

- [ ] **Step 3: Write the implementation**

Create `src/scroll-target.js`:

```js
// Finds the element that scrolls the manga strip. Some readers scroll the
// whole page, others scroll a box inside it, and some do a bit of both. The
// strip is almost always the thing that scrolls furthest, so that wins.
(function (root) {
  const MIN_SCROLL = 50;
  const SCROLLABLE = new Set(['auto', 'scroll', 'overlay']);

  function scrollDistance(el) {
    return el.scrollHeight - el.clientHeight;
  }

  function isOnScreen(el, view) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < view.innerHeight && r.right > 0 && r.left < view.innerWidth;
  }

  function findScrollTarget(doc, getStyle = (el) => doc.defaultView.getComputedStyle(el)) {
    let best = doc.scrollingElement;
    let bestDistance = Math.max(scrollDistance(best), MIN_SCROLL);
    for (const el of doc.querySelectorAll('*')) {
      if (el.clientHeight <= 0) continue;
      const distance = scrollDistance(el);
      if (distance <= bestDistance) continue;
      if (!SCROLLABLE.has(getStyle(el).overflowY)) continue;
      if (!isOnScreen(el, doc.defaultView)) continue;
      best = el;
      bestDistance = distance;
    }
    return best;
  }

  const api = { findScrollTarget };
  root.MangaScroll = Object.assign(root.MangaScroll || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/scroll-target.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/scroll-target.js test/scroll-target.test.js
git commit -m "Add scroll target finder" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Scroll engine — motion, speed, pause and stop

**Files:**
- Create: `src/scroller.js`
- Test: `test/scroller.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `createScroller({ target, now, requestFrame, cancelFrame, speed, onChange }) → scroller`.
  - `target`: `{ scrollTop, scrollHeight, clientHeight, scrollTo({ top, behavior }) }`
  - `now() → ms`, `requestFrame(fn) → id`, `cancelFrame(id)`
  - `speed`: initial px/s; invalid → 60
  - `onChange(state, speed)`: called on every state change and every `setSpeed`/`faster`/`slower`
  - scroller methods: `start()`, `pause()`, `resume()`, `toggle()`, `stop()`, `faster()`, `slower()`, `setSpeed(n)`, `getState() → string`, `getSpeed() → number`. Tasks 3 and 4 add `userActivity()` and the `holding`, `endWait`, `ended` states.
  - The initial state is `paused`. `start()` is the same as `resume()`.

- [ ] **Step 1: Write the failing test**

Create `test/scroller.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createScroller } = require('../src/scroller.js');

// A fake scrollable element, clock and frame queue. frames(n, ms) advances
// the clock by ms and runs the queued frame, n times, like requestAnimationFrame.
function setup({ scrollHeight = 10000, clientHeight = 1000, speed = 60 } = {}) {
  let time = 0;
  let queued = null;
  let nextId = 1;
  const target = {
    scrollTop: 0,
    scrollHeight,
    clientHeight,
    scrollTo({ top, behavior }) {
      assert.equal(behavior, 'instant');
      const max = Math.max(0, this.scrollHeight - this.clientHeight);
      this.scrollTop = Math.round(Math.min(Math.max(top, 0), max)); // browsers round
    },
  };
  const changes = [];
  const scroller = createScroller({
    target,
    now: () => time,
    requestFrame: (fn) => {
      queued = { fn, id: nextId };
      return nextId++;
    },
    cancelFrame: (id) => {
      if (queued && queued.id === id) queued = null;
    },
    speed,
    onChange: (state, value) => changes.push([state, value]),
  });
  return {
    scroller,
    target,
    changes,
    frames(count, ms = 100) {
      for (let i = 0; i < count; i++) {
        time += ms;
        const next = queued;
        queued = null;
        if (next) next.fn();
      }
    },
    hasPendingFrame: () => queued !== null,
  };
}

test('starts paused, then scrolls at the given speed once started', () => {
  const { scroller, target, frames, hasPendingFrame } = setup({ speed: 60 });
  assert.equal(scroller.getState(), 'paused');
  assert.equal(hasPendingFrame(), false);
  scroller.start();
  assert.equal(scroller.getState(), 'running');
  frames(10); // 1 second
  assert.equal(target.scrollTop, 60);
});

test('slow speeds still move even though the browser rounds scrollTop', () => {
  const { scroller, target, frames } = setup({ speed: 10 });
  scroller.start();
  frames(100, 16); // 1.6 s at 0.16 px per frame
  assert.equal(target.scrollTop, 16);
});

test('a long gap between frames moves at most 100 ms worth', () => {
  const { scroller, target, frames } = setup({ speed: 60 });
  scroller.start();
  frames(1, 5000); // e.g. coming back from another tab
  assert.equal(target.scrollTop, 6);
});

test('pause stops movement; resume continues from where the page is', () => {
  const { scroller, target, frames, hasPendingFrame } = setup({ speed: 60 });
  scroller.start();
  frames(5);
  scroller.pause();
  assert.equal(scroller.getState(), 'paused');
  assert.equal(hasPendingFrame(), false);
  target.scrollTop = 500; // the user moved the page while paused
  scroller.resume();
  frames(1);
  assert.equal(target.scrollTop, 506);
});

test('toggle switches between running and paused', () => {
  const { scroller } = setup();
  scroller.start();
  scroller.toggle();
  assert.equal(scroller.getState(), 'paused');
  scroller.toggle();
  assert.equal(scroller.getState(), 'running');
});

test('a jump caused by the page itself is adopted without pausing', () => {
  const { scroller, target, frames } = setup({ speed: 60 });
  scroller.start();
  frames(5); // at 30
  target.scrollTop = 400; // e.g. an image above loaded and the browser kept our place
  frames(1);
  assert.equal(scroller.getState(), 'running');
  assert.equal(target.scrollTop, 406);
});

test('speed steps by 10 and stays between 10 and 400', () => {
  const { scroller } = setup({ speed: 60 });
  scroller.faster();
  assert.equal(scroller.getSpeed(), 70);
  scroller.slower();
  scroller.slower();
  assert.equal(scroller.getSpeed(), 50);
  scroller.setSpeed(1000);
  assert.equal(scroller.getSpeed(), 400);
  scroller.faster();
  assert.equal(scroller.getSpeed(), 400);
  scroller.setSpeed(0);
  assert.equal(scroller.getSpeed(), 10);
  scroller.slower();
  assert.equal(scroller.getSpeed(), 10);
});

test('a missing or corrupted saved speed falls back to 60', () => {
  for (const bad of [undefined, null, NaN, 'fast', Infinity]) {
    assert.equal(setup({ speed: bad }).scroller.getSpeed(), 60, String(bad));
    const { scroller } = setup({ speed: 100 });
    scroller.setSpeed(bad);
    assert.equal(scroller.getSpeed(), 60, String(bad));
  }
});

test('every state and speed change is reported', () => {
  const { scroller, changes } = setup({ speed: 60 });
  scroller.start();
  scroller.faster();
  scroller.pause();
  assert.deepEqual(changes, [
    ['running', 60],
    ['running', 70],
    ['paused', 70],
  ]);
});

test('stop is final', () => {
  const { scroller, target, frames, hasPendingFrame } = setup();
  scroller.start();
  scroller.stop();
  scroller.toggle();
  scroller.start();
  frames(5);
  assert.equal(scroller.getState(), 'stopped');
  assert.equal(hasPendingFrame(), false);
  assert.equal(target.scrollTop, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/scroller.test.js`
Expected: FAIL with `Cannot find module '../src/scroller.js'`

- [ ] **Step 3: Write the implementation**

Create `src/scroller.js`:

```js
// The scroll engine. Moves a target down at a steady speed. Has no DOM
// dependencies, so it is tested with a fake target, clock and frame queue.
(function (root) {
  const DEFAULT_SPEED = 60;
  const MIN_SPEED = 10;
  const MAX_SPEED = 400;
  const SPEED_STEP = 10;
  const MAX_FRAME_MS = 100; // longer gaps (e.g. a background tab) never cause a jump
  const DRIFT_PX = 3; // a bigger difference means something else moved the page
  const ACTIVE = new Set(['running']);

  function clampSpeed(n) {
    if (!Number.isFinite(n)) return DEFAULT_SPEED;
    return Math.min(MAX_SPEED, Math.max(MIN_SPEED, n));
  }

  function createScroller({ target, now, requestFrame, cancelFrame, speed, onChange = () => {} }) {
    let state = 'paused';
    let currentSpeed = clampSpeed(speed);
    let pos = 0; // float, so slow speeds accumulate instead of rounding to zero
    let written = 0;
    let lastFrame = 0;
    let frameId = null;

    const maxPos = () => Math.max(0, target.scrollHeight - target.clientHeight);

    function setState(next) {
      if (next === state) return;
      const wasActive = ACTIVE.has(state);
      state = next;
      if (ACTIVE.has(state) && !wasActive) {
        lastFrame = now();
        frameId = requestFrame(frame);
      } else if (!ACTIVE.has(state) && wasActive && frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
      onChange(state, currentSpeed);
    }

    function frame() {
      frameId = null;
      const t = now();
      const dt = Math.min(t - lastFrame, MAX_FRAME_MS);
      lastFrame = t;

      const actual = target.scrollTop;
      if (Math.abs(actual - written) > DRIFT_PX) {
        pos = actual;
        written = actual;
      }

      if (state === 'running') advance(dt);

      if (ACTIVE.has(state)) frameId = requestFrame(frame);
    }

    function advance(dt) {
      pos = Math.min(pos + (currentSpeed * dt) / 1000, maxPos());
      target.scrollTo({ top: pos, behavior: 'instant' });
      written = pos;
    }

    function resume() {
      if (state !== 'paused') return;
      pos = target.scrollTop;
      written = pos;
      setState('running');
    }

    function pause() {
      if (ACTIVE.has(state)) setState('paused');
    }

    function toggle() {
      if (ACTIVE.has(state)) pause();
      else resume();
    }

    function stop() {
      setState('stopped');
    }

    function setSpeed(n) {
      currentSpeed = clampSpeed(n);
      onChange(state, currentSpeed);
    }

    return {
      start: resume,
      pause,
      resume,
      toggle,
      stop,
      faster: () => setSpeed(currentSpeed + SPEED_STEP),
      slower: () => setSpeed(currentSpeed - SPEED_STEP),
      setSpeed,
      getState: () => state,
      getSpeed: () => currentSpeed,
    };
  }

  const api = { createScroller, DEFAULT_SPEED, MIN_SPEED, MAX_SPEED };
  root.MangaScroll = Object.assign(root.MangaScroll || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/scroller.test.js`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
git add src/scroller.js test/scroller.test.js
git commit -m "Add scroll engine with steady speed, pause and stop" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Scroll engine — hold while the user scrolls by hand

**Files:**
- Modify: `src/scroller.js`
- Test: `test/scroller.test.js` (append)

**Interfaces:**
- Consumes: `createScroller` from Task 2
- Produces: `scroller.userActivity()`. From `running` (and later `endWait`) it enters `holding` and resumes 1500 ms after the last call. No effect in `paused`, `ended`, `stopped`. New state `holding`.

- [ ] **Step 1: Write the failing tests**

Append to `test/scroller.test.js`:

```js
test('scrolling by hand holds for 1.5 s, then carries on from the new position', () => {
  const { scroller, target, frames } = setup({ speed: 60 });
  scroller.start();
  frames(5); // t=500, at 30
  scroller.userActivity(); // resume at t=2000
  assert.equal(scroller.getState(), 'holding');
  target.scrollTop = 800; // where the user's scroll landed
  frames(14); // t=1900
  assert.equal(scroller.getState(), 'holding');
  assert.equal(target.scrollTop, 800);
  frames(1); // t=2000: hold over
  assert.equal(scroller.getState(), 'running');
  frames(1);
  assert.equal(target.scrollTop, 806);
});

test('more input while holding extends the hold', () => {
  const { scroller, frames, changes } = setup();
  scroller.start();
  frames(5); // t=500
  scroller.userActivity(); // until 2000
  frames(10); // t=1500
  scroller.userActivity(); // until 3000
  frames(14); // t=2900
  assert.equal(scroller.getState(), 'holding');
  frames(1); // t=3000
  assert.equal(scroller.getState(), 'running');
  assert.equal(changes.filter(([state]) => state === 'holding').length, 1);
});

test('input while paused does not start or hold anything', () => {
  const { scroller, hasPendingFrame } = setup();
  scroller.start();
  scroller.pause();
  scroller.userActivity();
  assert.equal(scroller.getState(), 'paused');
  assert.equal(hasPendingFrame(), false);
});

test('pausing while holding pauses; resuming runs straight away', () => {
  const { scroller, target, frames } = setup({ speed: 60 });
  scroller.start();
  frames(5); // at 30
  scroller.userActivity();
  scroller.toggle();
  assert.equal(scroller.getState(), 'paused');
  scroller.toggle();
  assert.equal(scroller.getState(), 'running');
  frames(1);
  assert.equal(target.scrollTop, 36);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/scroller.test.js`
Expected: FAIL with `scroller.userActivity is not a function`

- [ ] **Step 3: Implement holding**

In `src/scroller.js`:

Replace the constants block line `const ACTIVE = new Set(['running']);` with:

```js
  const HOLD_MS = 1500;
  const ACTIVE = new Set(['running', 'holding']);
```

Add `let resumeAt = 0;` after `let frameId = null;`.

Replace the line `if (state === 'running') advance(dt);` inside `frame()` with:

```js
      if (state === 'running') advance(dt);
      else if (state === 'holding') checkHold(t);
```

Add after `advance`:

```js
    function checkHold(t) {
      if (t >= resumeAt) setState('running');
    }
```

Add after `stop`:

```js
    // The user scrolled by hand (wheel, touch, keys, a click or scrollbar drag).
    // Chrome often sends no pointerup after a scrollbar drag, so every input
    // is a fixed-length hold rather than "hold until released".
    function userActivity() {
      if (!ACTIVE.has(state)) return;
      resumeAt = now() + HOLD_MS;
      setState('holding');
    }
```

Add `userActivity,` to the returned object after `setSpeed,`.

Update the file's header comment to:

```js
// The scroll engine. Moves a target down at a steady speed and holds while the
// user scrolls by hand. Has no DOM dependencies, so it is tested with a fake
// target, clock and frame queue.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/scroller.test.js`
Expected: PASS, 14 tests

- [ ] **Step 5: Commit**

```bash
git add src/scroller.js test/scroller.test.js
git commit -m "Hold auto-scroll for 1.5 s after the user scrolls by hand" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Scroll engine — end of chapter

**Files:**
- Modify: `src/scroller.js`
- Test: `test/scroller.test.js` (append)

**Interfaces:**
- Consumes: `createScroller` from Tasks 2–3
- Produces: states `endWait` (at the bottom, waiting for more content, frames still running) and `ended` (no frames). `toggle()`/`resume()` from `ended` returns to `running`. `userActivity()` from `endWait` enters `holding`.

- [ ] **Step 1: Write the failing tests**

Append to `test/scroller.test.js`:

```js
const SHORT = { scrollHeight: 1100, clientHeight: 1000, speed: 400 }; // 100 px to scroll

test('at the bottom it waits, then stops after 3 s with no new content', () => {
  const { scroller, target, frames, hasPendingFrame } = setup(SHORT);
  scroller.start();
  frames(3); // 40, 80, 100 (bottom) at t=300
  assert.equal(target.scrollTop, 100);
  assert.equal(scroller.getState(), 'endWait');
  frames(29); // t=3200
  assert.equal(scroller.getState(), 'endWait');
  frames(1); // t=3300: 3 s at the bottom
  assert.equal(scroller.getState(), 'ended');
  assert.equal(hasPendingFrame(), false);
});

test('if more pages load during the wait, it keeps scrolling', () => {
  const { scroller, target, frames } = setup(SHORT);
  scroller.start();
  frames(3); // bottom
  target.scrollHeight = 3000; // late images arrived
  frames(1);
  assert.equal(scroller.getState(), 'running');
  frames(1);
  assert.equal(target.scrollTop, 140);
});

test('resuming after the end with nothing new ends again after 3 s', () => {
  const { scroller, frames } = setup(SHORT);
  scroller.start();
  frames(33);
  assert.equal(scroller.getState(), 'ended');
  scroller.toggle();
  assert.equal(scroller.getState(), 'running');
  frames(1);
  assert.equal(scroller.getState(), 'endWait');
  frames(30);
  assert.equal(scroller.getState(), 'ended');
});

test('resuming after the end when the page grew keeps scrolling', () => {
  const { scroller, target, frames } = setup(SHORT);
  scroller.start();
  frames(33);
  target.scrollHeight = 5000; // e.g. the reader appended the next chapter
  scroller.toggle();
  frames(2);
  assert.equal(scroller.getState(), 'running');
  assert.equal(target.scrollTop, 180);
});

test('pausing during the end wait pauses', () => {
  const { scroller, frames, hasPendingFrame } = setup(SHORT);
  scroller.start();
  frames(3);
  scroller.toggle();
  assert.equal(scroller.getState(), 'paused');
  assert.equal(hasPendingFrame(), false);
});

test('scrolling back up during the end wait holds, then scrolls on', () => {
  const { scroller, target, frames } = setup(SHORT);
  scroller.start();
  frames(3); // t=300, endWait
  scroller.userActivity(); // resume at t=1800
  target.scrollTop = 0;
  frames(15); // t=1800
  assert.equal(scroller.getState(), 'running');
  frames(1);
  assert.equal(target.scrollTop, 40);
});

test('a page that cannot scroll at all ends instead of spinning forever', () => {
  const { scroller, frames } = setup({ scrollHeight: 800, clientHeight: 1000 });
  scroller.start();
  frames(1);
  assert.equal(scroller.getState(), 'endWait');
  frames(30);
  assert.equal(scroller.getState(), 'ended');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/scroller.test.js`
Expected: FAIL; the first new test reports `'running' !== 'endWait'`

- [ ] **Step 3: Implement end detection**

In `src/scroller.js`:

Replace the constants lines

```js
  const HOLD_MS = 1500;
  const ACTIVE = new Set(['running', 'holding']);
```

with:

```js
  const HOLD_MS = 1500;
  const END_WAIT_MS = 3000; // lazy-loaded images below may still be arriving
  const ACTIVE = new Set(['running', 'holding', 'endWait']);
```

Add `let endSince = 0;` after `let resumeAt = 0;`.

Replace these lines inside `frame()`

```js
      if (state === 'running') advance(dt);
      else if (state === 'holding') checkHold(t);
```

with:

```js
      if (state === 'running') advance(dt, t);
      else if (state === 'holding') checkHold(t);
      else if (state === 'endWait') checkEnd(t);
```

Replace the whole `advance` function with:

```js
    function advance(dt, t) {
      const max = maxPos();
      pos = Math.min(pos + (currentSpeed * dt) / 1000, max);
      target.scrollTo({ top: pos, behavior: 'instant' });
      written = pos;
      if (pos >= max - 1) {
        endSince = t;
        setState('endWait');
      }
    }
```

Add after `checkHold`:

```js
    function checkEnd(t) {
      if (maxPos() > pos + 1) setState('running');
      else if (t - endSince >= END_WAIT_MS) setState('ended');
    }
```

In `resume()`, replace `if (state !== 'paused') return;` with:

```js
      if (state !== 'paused' && state !== 'ended') return;
```

Update the file's header comment to:

```js
// The scroll engine. Moves a target down at a steady speed, holds while the
// user scrolls by hand, and stops once the page has stopped growing at the
// bottom. Has no DOM dependencies, so it is tested with a fake target, clock
// and frame queue.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/scroller.test.js`
Expected: PASS, 21 tests

- [ ] **Step 5: Commit**

```bash
git add src/scroller.js test/scroller.test.js
git commit -m "Stop at the end of a chapter once no more pages load" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Key mapping

**Files:**
- Create: `src/keys.js`
- Test: `test/keys.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `keyAction(event) → 'toggle' | 'faster' | 'slower' | 'off' | 'activity' | null`. Reads `event.key`, `ctrlKey`, `metaKey`, `altKey`, `isComposing`, `target.tagName`, `target.isContentEditable`.

- [ ] **Step 1: Write the failing test**

Create `test/keys.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { keyAction } = require('../src/keys.js');

const body = { tagName: 'BODY', isContentEditable: false };
const press = (key, extra = {}) =>
  keyAction({ key, target: body, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...extra });

test('control keys map to actions', () => {
  assert.equal(press(' '), 'toggle');
  assert.equal(press('='), 'faster');
  assert.equal(press('+'), 'faster');
  assert.equal(press('-'), 'slower');
  assert.equal(press('_'), 'slower');
  assert.equal(press('Escape'), 'off');
});

test('page-scrolling keys count as the user scrolling by hand', () => {
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
    assert.equal(press(key), 'activity', key);
  }
});

test('other keys are left alone', () => {
  for (const key of ['a', 's', 'Enter', 'Tab', 'ArrowLeft']) {
    assert.equal(press(key), null, key);
  }
});

test('keys with Ctrl, Cmd or Alt held are left alone', () => {
  assert.equal(press(' ', { ctrlKey: true }), null);
  assert.equal(press('=', { metaKey: true }), null); // Cmd+= is browser zoom
  assert.equal(press('-', { altKey: true }), null);
});

test('typing in text fields is left alone', () => {
  const fields = [
    { tagName: 'INPUT', isContentEditable: false },
    { tagName: 'TEXTAREA', isContentEditable: false },
    { tagName: 'SELECT', isContentEditable: false },
    { tagName: 'DIV', isContentEditable: true },
  ];
  for (const target of fields) {
    assert.equal(press(' ', { target }), null, target.tagName);
    assert.equal(press('ArrowDown', { target }), null, target.tagName);
  }
});

test('keys during IME composition are left alone', () => {
  assert.equal(press(' ', { isComposing: true }), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/keys.test.js`
Expected: FAIL with `Cannot find module '../src/keys.js'`

- [ ] **Step 3: Write the implementation**

Create `src/keys.js`:

```js
// Maps a keydown event to what the scroller should do, or null to leave the
// key alone. Typing in text fields and shortcuts with modifiers are never ours.
(function (root) {
  const EDITABLE = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
  const ACTIONS = { ' ': 'toggle', '=': 'faster', '+': 'faster', '-': 'slower', _: 'slower', Escape: 'off' };
  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);

  function isEditable(el) {
    return Boolean(el) && (EDITABLE.has(el.tagName) || el.isContentEditable === true);
  }

  function keyAction(event) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
    if (isEditable(event.target)) return null;
    if (Object.hasOwn(ACTIONS, event.key)) return ACTIONS[event.key];
    return SCROLL_KEYS.has(event.key) ? 'activity' : null;
  }

  const api = { keyAction };
  root.MangaScroll = Object.assign(root.MangaScroll || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/keys.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/keys.js test/keys.test.js
git commit -m "Add key mapping for pause, speed and off" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Badge

**Files:**
- Create: `src/badge.js`
- Test: `test/badge.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `badgeText(state, speed) → string`
  - `createBadge(doc) → { show(state, speed), remove() }`. Appends a `<manga-scroll-badge>` element to `doc.documentElement` with an open shadow root containing `<div class="pill">`. `show` sets the text, makes it fully opaque, and fades it to 0.15 opacity after 2000 ms.

`createBadge` touches the DOM, so it is checked by the smoke test in Task 8. This task unit-tests `badgeText`.

- [ ] **Step 1: Write the failing test**

Create `test/badge.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { badgeText } = require('../src/badge.js');

test('badge text for each state', () => {
  assert.equal(badgeText('running', 60), '▶︎ 60');
  assert.equal(badgeText('holding', 60), '▶︎ 60');
  assert.equal(badgeText('endWait', 60), '▶︎ 60');
  assert.equal(badgeText('paused', 70), '❚❚ 70');
  assert.equal(badgeText('ended', 70), '■ End');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/badge.test.js`
Expected: FAIL with `Cannot find module '../src/badge.js'`

- [ ] **Step 3: Write the implementation**

Create `src/badge.js`:

```js
// The small status pill in the bottom-right corner. It lives in a shadow root
// so site CSS cannot restyle it, and ignores the mouse so it never blocks clicks.
(function (root) {
  const FADE_MS = 2000;
  const HOST_STYLE = [
    'all: initial',
    'position: fixed',
    'right: 16px',
    'bottom: 16px',
    'z-index: 2147483647',
    'pointer-events: none',
  ]
    .map((rule) => rule + ' !important')
    .join('; ');
  const PILL_CSS = `
    .pill {
      font: 600 13px/1 system-ui, -apple-system, sans-serif;
      color: #fff;
      background: rgba(20, 20, 20, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.4);
      border-radius: 999px;
      padding: 6px 10px;
      white-space: nowrap;
      transition: opacity 400ms ease;
    }
    .pill.faded { opacity: 0.15; }
  `;

  function badgeText(state, speed) {
    if (state === 'ended') return '■ End';
    if (state === 'paused') return '❚❚ ' + speed;
    return '▶︎ ' + speed; // ︎: draw ▶ as text, not as an emoji
  }

  function createBadge(doc) {
    const host = doc.createElement('manga-scroll-badge');
    host.style.cssText = HOST_STYLE;
    const style = doc.createElement('style');
    style.textContent = PILL_CSS;
    const pill = doc.createElement('div');
    pill.className = 'pill';
    host.attachShadow({ mode: 'open' }).append(style, pill);
    // On <html>, not <body>: a transformed body would break position: fixed.
    doc.documentElement.appendChild(host);

    let fadeTimer = null;
    return {
      show(state, speed) {
        pill.textContent = badgeText(state, speed);
        pill.classList.remove('faded');
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(() => pill.classList.add('faded'), FADE_MS);
      },
      remove() {
        clearTimeout(fadeTimer);
        host.remove();
      },
    };
  }

  const api = { badgeText, createBadge };
  root.MangaScroll = Object.assign(root.MangaScroll || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/badge.test.js`
Expected: PASS, 1 test

- [ ] **Step 5: Commit**

```bash
git add src/badge.js test/badge.test.js
git commit -m "Add corner status badge" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Background worker, manifest and icons

**Files:**
- Create: `src/background.js`, `manifest.json`, `scripts/make-icons.js`, `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png` (generated)
- Test: `test/background.test.js`, `test/manifest.test.js`

**Interfaces:**
- Consumes: the content script file paths from Tasks 1, 2, 5, 6 and Task 8's `src/content.js`
- Produces:
  - `CONTENT_FILES`: the injection order array from Global Constraints
  - `toggleInTab(tabId, scripting) → Promise<void>`. Checks `window.__mangaScroll` in the tab; calls its `toggle()` if present, otherwise injects `CONTENT_FILES`. Ignores a second call for the same tab while one is in flight. Catches and `console.warn`s injection errors.
  - Task 8's smoke test imports `CONTENT_FILES`.

- [ ] **Step 1: Write the failing tests**

Create `test/background.test.js`:

```js
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
```

Create `test/manifest.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const exists = (file) => fs.existsSync(path.join(ROOT, file));

test('manifest asks only for the three permissions in the spec', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
});

test('Alt+S is the suggested shortcut', () => {
  assert.equal(manifest.commands['toggle-scroll'].suggested_key.default, 'Alt+S');
});

test('every file the manifest points to exists', () => {
  const files = [
    manifest.background.service_worker,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const file of files) assert.ok(exists(file), file);
});

test('icons are PNGs of the size their key says', () => {
  for (const [size, file] of Object.entries(manifest.icons)) {
    const png = fs.readFileSync(path.join(ROOT, file));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', file);
    assert.equal(png.readUInt32BE(16), Number(size), `${file} width`);
    assert.equal(png.readUInt32BE(20), Number(size), `${file} height`);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/background.test.js test/manifest.test.js`
Expected: FAIL with `Cannot find module '../src/background.js'` and `ENOENT ... manifest.json`

- [ ] **Step 3: Write `src/background.js`**

```js
// Runs when Alt+S is pressed or the toolbar icon is clicked. Loads the
// scroller into the current tab the first time, and toggles it after that.
const CONTENT_FILES = [
  'src/scroll-target.js',
  'src/scroller.js',
  'src/badge.js',
  'src/keys.js',
  'src/content.js',
];

const inFlight = new Set(); // tabs with a toggle in progress, so a double press injects once

async function toggleInTab(tabId, scripting) {
  if (inFlight.has(tabId)) return;
  inFlight.add(tabId);
  try {
    const target = { tabId };
    const [check] = await scripting.executeScript({ target, func: () => Boolean(window.__mangaScroll) });
    if (check.result) {
      await scripting.executeScript({ target, func: () => window.__mangaScroll.toggle() });
    } else {
      await scripting.executeScript({ target, files: CONTENT_FILES });
    }
  } catch (err) {
    // Browser pages and the extension store do not allow scripts.
    console.warn('Manga Auto-Scroll cannot run on this page:', err.message);
  } finally {
    inFlight.delete(tabId);
  }
}

if (typeof chrome !== 'undefined' && chrome.commands) {
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'toggle-scroll' && tab?.id !== undefined) toggleInTab(tab.id, chrome.scripting);
  });
  chrome.action.onClicked.addListener((tab) => toggleInTab(tab.id, chrome.scripting));
}

if (typeof module !== 'undefined') module.exports = { toggleInTab, CONTENT_FILES };
```

- [ ] **Step 4: Write `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Manga Auto-Scroll",
  "version": "0.1.0",
  "description": "Hands-free steady auto-scroll for long-strip manga. Press Alt+S to start or pause.",
  "permissions": ["activeTab", "scripting", "storage"],
  "background": { "service_worker": "src/background.js" },
  "action": {
    "default_title": "Manga Auto-Scroll (Alt+S)",
    "default_icon": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" }
  },
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" },
  "commands": {
    "toggle-scroll": {
      "suggested_key": { "default": "Alt+S" },
      "description": "Start, pause or resume auto-scroll"
    }
  }
}
```

- [ ] **Step 5: Write `scripts/make-icons.js` and generate the icons**

```js
// Generates icons/icon{16,48,128}.png: an orange rounded square with a white
// down arrow. Uses only Node built-ins. Run: node scripts/make-icons.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BG = [228, 87, 46];
const FG = [255, 255, 255];
const SAMPLES = 4; // 4x4 supersampling for smooth edges

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// Shapes in unit coordinates (0..1, y down).
function inRoundedSquare(x, y) {
  const r = 0.22;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function inArrow(x, y) {
  const shaft = Math.abs(x - 0.5) <= 0.075 && y >= 0.18 && y <= 0.56;
  const head = y >= 0.48 && y <= 0.82 && Math.abs(x - 0.5) <= (0.27 * (0.82 - y)) / 0.34;
  return shaft || head;
}

function render(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride); // each row starts with filter byte 0
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (!inRoundedSquare(x, y)) continue;
          if (inArrow(x, y)) fg++;
          else bg++;
        }
      }
      const covered = bg + fg;
      const i = py * stride + 1 + px * 4;
      for (let c = 0; c < 3; c++) raw[i + c] = covered ? Math.round((BG[c] * bg + FG[c] * fg) / covered) : 0;
      raw[i + 3] = Math.round((255 * covered) / (SAMPLES * SAMPLES));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), render(size));
}
console.log('Wrote icons/icon16.png, icon48.png, icon128.png');
```

Run: `node scripts/make-icons.js`
Expected: `Wrote icons/icon16.png, icon48.png, icon128.png`

Then look at `icons/icon128.png` (open it, or view it with an image-reading tool). Expected: an orange rounded square with a white down arrow and no stray pixels.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test test/background.test.js test/manifest.test.js`
Expected: PASS, 9 tests

- [ ] **Step 7: Commit**

```bash
git add src/background.js manifest.json scripts/make-icons.js icons test/background.test.js test/manifest.test.js
git commit -m "Add background worker, manifest and icons" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Content wiring, test page and browser smoke test

**Files:**
- Create: `src/content.js`, `test/reader.html`, `test/browser-smoke.js`
- Modify: `test/manifest.test.js` (append one test)

**Interfaces:**
- Consumes: `MangaScroll.findScrollTarget` (Task 1), `MangaScroll.createScroller` (Tasks 2–4), `MangaScroll.createBadge` (Task 6), `MangaScroll.keyAction` (Task 5), `CONTENT_FILES` (Task 7)
- Produces: `window.__mangaScroll = { toggle(), off() }` in the extension's isolated world. Task 7's `toggleInTab` calls `toggle()`.

`content.js` only wires browser APIs together, so its test is the headless-Chrome smoke test. The smoke test injects the files into the page's main world with `chrome.storage` stubbed, which exercises the same code the extension runs.

- [ ] **Step 1: Write the test page**

Create `test/reader.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fake manga reader</title>
<style>
  body { margin: 0; background: #111; color: #eee; font-family: system-ui, sans-serif; }
  header { height: 56px; display: flex; gap: 12px; align-items: center; padding: 0 16px; background: #222; }
  #log { font-size: 12px; color: #f88; }
  .reader { height: calc(100vh - 56px); overflow-y: auto; scroll-behavior: smooth; scroll-snap-type: y mandatory; }
  .page {
    box-sizing: border-box; width: min(720px, 100%); height: 1100px; margin: 0 auto;
    display: flex; align-items: center; justify-content: center; scroll-snap-align: start;
    border-bottom: 4px solid #111; background: #f4f1ea; color: #333; font-size: 56px; font-weight: 700;
  }
  .page.late { background: #dfe8f4; }
  footer { height: 160px; padding: 16px; background: #222; }
</style>
</head>
<body>
<header>
  <input id="typing" placeholder="Type here: Space, = and - must type, not control scrolling">
  <button id="next">Next chapter (no page load)</button>
  <span id="log"></span>
</header>
<main id="slot"></main>
<footer>Footer: makes the whole page scroll a little, like many real sites.</footer>
<script>
  // Awkward on purpose:
  // - the strip scrolls inside a box, while the page itself also scrolls by 160 px
  // - the box has smooth scrolling and mandatory scroll snapping
  // - the last three pages arrive 2 s late, like lazy-loaded images
  // - "Next chapter" swaps in a new box without reloading, like single-page readers
  // - the site has its own Space handler, which must not run while auto-scroll is on
  let chapter = 0;

  function addPages(reader, from, to, late) {
    for (let i = from; i <= to; i++) {
      const page = document.createElement('div');
      page.className = late ? 'page late' : 'page';
      page.textContent = `Ch ${chapter} · Page ${i}`;
      reader.append(page);
    }
  }

  function loadChapter() {
    chapter++;
    const reader = document.createElement('div');
    reader.className = 'reader';
    reader.id = 'reader';
    addPages(reader, 1, 12, false);
    document.getElementById('slot').replaceChildren(reader);
    setTimeout(() => addPages(reader, 13, 15, true), 2000);
  }

  document.getElementById('next').addEventListener('click', loadChapter);
  document.addEventListener('keydown', (event) => {
    if (event.key === ' ' && event.target === document.body) {
      document.getElementById('log').textContent = 'Site Space handler ran';
    }
  });
  loadChapter();
</script>
</body>
</html>
```

- [ ] **Step 2: Write the smoke test**

Create `test/browser-smoke.js`:

```js
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

async function run(page) {
  await page.evaluate(`Object.defineProperty(window, 'chrome', { configurable: true, value: {
    storage: { local: { get: async () => ({ speed: 200 }), set: async () => {} } },
  } }); true`);
  for (const file of CONTENT_FILES) {
    await page.evaluate(fs.readFileSync(path.join(ROOT, file), 'utf8') + '\n;true');
  }
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
  } finally {
    page?.close();
    if (browser.exitCode === null && browser.signalCode === null) {
      const exited = new Promise((resolve) => browser.once('exit', resolve));
      browser.kill();
      await exited;
    }
    fs.rmSync(profile, { recursive: true, force: true });
  }
  console.log(`\nScreenshot: ${SCREENSHOT}`);
  console.log(failures.length ? `${failures.length} check(s) failed` : 'All checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Add the content-file existence test**

Append to `test/manifest.test.js`:

```js
test('every content script background.js injects exists', () => {
  const { CONTENT_FILES } = require('../src/background.js');
  for (const file of CONTENT_FILES) assert.ok(exists(file), file);
});
```

- [ ] **Step 4: Run both to verify they fail**

Run: `node --test test/manifest.test.js`
Expected: FAIL on `src/content.js`

Run: `node test/browser-smoke.js`
Expected: exits 1 with `ENOENT ... src/content.js`

- [ ] **Step 5: Write `src/content.js`**

```js
// Wires the scroll engine, badge and keys to the page. background.js injects
// this file last, after its dependencies, the first time Alt+S is pressed on a tab.
(function (root) {
  const { findScrollTarget, createScroller, createBadge, keyAction } = root.MangaScroll;
  const STORAGE_KEY = 'speed';

  function loadSpeed() {
    try {
      return chrome.storage.local.get(STORAGE_KEY).then(
        (items) => items[STORAGE_KEY],
        () => undefined,
      );
    } catch {
      return Promise.resolve(undefined); // the extension was reloaded under this page
    }
  }

  function saveSpeed(speed) {
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: speed }).catch(() => {});
    } catch {
      // the extension was reloaded under this page; nothing to save to
    }
  }

  function mount() {
    const target = findScrollTarget(document);
    const snap = {
      value: target.style.getPropertyValue('scroll-snap-type'),
      priority: target.style.getPropertyPriority('scroll-snap-type'),
    };
    target.style.setProperty('scroll-snap-type', 'none', 'important');

    const badge = createBadge(document);
    const scroller = createScroller({
      target,
      now: () => performance.now(),
      requestFrame: (fn) => requestAnimationFrame(fn),
      cancelFrame: (id) => cancelAnimationFrame(id),
      onChange: (state, speed) => badge.show(state, speed),
    });

    function toggle() {
      if (!target.isConnected) {
        // The reader swapped in a new scroll box (next chapter without a page load).
        off();
        mount();
        return;
      }
      scroller.toggle();
    }

    function off() {
      scroller.stop();
      badge.remove();
      for (const [type, fn, options] of listeners) root.removeEventListener(type, fn, options);
      if (snap.value) target.style.setProperty('scroll-snap-type', snap.value, snap.priority);
      else target.style.removeProperty('scroll-snap-type');
      delete root.__mangaScroll;
    }

    function onKeyDown(event) {
      const action = keyAction(event);
      if (!action) return;
      if (action === 'activity') return scroller.userActivity();
      if (action === 'off') return off(); // the page still gets Esc, e.g. to close its own menus
      event.preventDefault();
      event.stopPropagation(); // keep the site's own Space or +/- handlers out of it
      if (action === 'toggle') return toggle();
      if (action === 'faster') scroller.faster();
      else scroller.slower();
      saveSpeed(scroller.getSpeed());
    }

    const onActivity = () => scroller.userActivity();
    const listeners = [
      ['keydown', onKeyDown, { capture: true }],
      ['wheel', onActivity, { capture: true, passive: true }],
      ['touchmove', onActivity, { capture: true, passive: true }],
      ['pointerdown', onActivity, { capture: true, passive: true }],
    ];
    for (const [type, fn, options] of listeners) root.addEventListener(type, fn, options);

    // Set before the async speed read, so a second injection sees it and backs off.
    root.__mangaScroll = { toggle, off };
    loadSpeed().then((speed) => {
      scroller.setSpeed(speed);
      scroller.start();
    });
  }

  if (!root.__mangaScroll) mount();
})(globalThis);
```

- [ ] **Step 6: Run the unit tests and the smoke test to verify they pass**

Run: `node --test test/`
Expected: PASS, 44 tests (6 + 21 + 6 + 1 + 5 + 5)

Run: `node test/browser-smoke.js`
Expected: every line `PASS`, then `All checks passed`. Look at the screenshot path it prints. Expected: the reader with the `■ End` pill in the bottom-right corner, legible.

If `Object.defineProperty(window, 'chrome', ...)` throws, replace that evaluate with `window.chrome = window.chrome || {}; window.chrome.storage = { local: { get: async () => ({ speed: 200 }), set: async () => {} } }; true`.

- [ ] **Step 7: Commit**

```bash
git add src/content.js test/reader.html test/browser-smoke.js test/manifest.test.js
git commit -m "Wire scroller to the page, add test reader and browser smoke test" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: README and hand-off

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything above
- Produces: install and usage instructions plus the manual checklist that you run in Comet

- [ ] **Step 1: Write `README.md`**

````markdown
# Manga Auto-Scroll

Hands-free reading for long-strip manga in Perplexity Comet (or any Chromium browser).
Press `Alt+S` on a chapter and it scrolls at a steady speed until the end.

## Install (Comet)

1. Open Comet's extensions page: type `chrome://extensions` in the address bar.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder (`manga-autoscroll`).
4. Open the extension shortcuts page (`chrome://extensions/shortcuts`) and check that
   **Start, pause or resume auto-scroll** is set to `Alt+S` (Option+S on Mac). If it is
   empty, another extension took it; pick any free shortcut.

After changing the code, click the reload icon on the extension's card and reload the manga tab.

## Use

| Key | Action |
|---|---|
| `Alt+S` or toolbar icon | Start, pause or resume |
| `Space` | Pause / resume (while it is on) |
| `=` / `-` | Faster / slower, by 10 px/s (10–400; remembered) |
| `Esc` | Turn it off |

The pill in the bottom-right corner shows the state and speed and fades after 2 seconds.
Scrolling by hand pauses it for 1.5 seconds. At the end of the chapter it waits 3 seconds
for late images, then shows `■ End`. Each new chapter page needs one `Alt+S`.

## Troubleshooting

- **Nothing happens on `Alt+S`.** Check the shortcut on `chrome://extensions/shortcuts`.
  Browser pages (`chrome://…`, the extension store) never allow extensions.
- **Nothing happens on a local file.** On the extension's details page, turn on
  **Allow access to file URLs**.
- **It scrolls the wrong thing.** Open an issue with the site's URL: the reader probably
  uses a layout the target finder does not expect.

## Development

```bash
node --test test/            # unit tests, no install needed (Node 18+)
node test/browser-smoke.js   # real-browser checks in headless Google Chrome
node scripts/make-icons.js   # regenerate icons
```

## Manual checklist (Comet)

Open `test/reader.html` (drag it into a Comet tab), then:

1. `Alt+S`: scrolling starts, the pill shows `▶ 60` (or your saved speed).
2. `=` and `-` change the speed. Reload, press `Alt+S`: the speed is remembered.
3. `Space` pauses and resumes. Typing in the text box does not, and the red
   "Site Space handler ran" message never appears while it is on.
4. Scroll with the trackpad: it pauses, then carries on about 1.5 s later.
5. Drag the scrollbar and let go: it carries on about 1.5 s later.
6. Near the bottom it waits for the late (blue) pages, then shows `■ End`.
7. Click "Next chapter", press `Alt+S`: the new chapter scrolls.
8. `Esc` removes the pill and the keys stop responding.
9. Repeat 1–8 (except 7) on a real manga site in long-strip mode.
````

- [ ] **Step 2: Run the full verification**

Run: `node --test test/`
Expected: PASS, 44 tests

Run: `node test/browser-smoke.js`
Expected: `All checks passed`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Add README with install steps and manual checklist" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Hand off to the user**

Give the user the README install steps and the manual checklist. Claude cannot drive Comet, so the last check is the user loading the extension and running the checklist.
