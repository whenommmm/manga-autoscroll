# Manga Auto-Scroll: Design

Date: 2026-10-12
Status: Approved; refined during planning (scroll-target rule, pointer
handling, in-place chapter changes, double-press guard, smoke test)

## Goal

Read long-strip manga in Perplexity Comet without scrolling by hand. Open a
chapter, press one key, and read to the bottom without touching anything.

## Decisions made

| Question | Decision |
|---|---|
| Control model | Auto-scroll; an occasional key press to start, pause or change speed is fine |
| Page layout | Long vertical strip (webtoon / "long strip" mode) |
| Browser | Perplexity Comet (Chromium-based, loads Chrome MV3 extensions) |
| Pacing | Steady speed, adjustable with keys |
| End of chapter | Stop and show "End"; no auto-navigation |
| Activation | On demand via shortcut or toolbar icon (`activeTab`), not on every site |
| Distribution | Personal use, loaded unpacked in developer mode |

## Non-goals

- Going to the next chapter automatically
- Smart pacing (speeding through gaps, slowing on panels)
- Page-by-page readers that need a "next" click
- Voice, webcam, or eye-tracking control
- Per-site speed settings
- Web Store publishing, Firefox, Safari, mobile

## User experience

### Starting

Press `Alt+S` (Option+S on Mac) or click the toolbar icon on a manga tab.
Scrolling starts immediately at the saved speed. The shortcut can be changed
on the browser's extension shortcuts page.

Each new chapter is a new page load, which removes the extension from the
tab, so the user presses `Alt+S` once per chapter.

### Keys while active

These keys work only on the active tab. They are ignored when focus is in an
`input`, `textarea`, `select`, or `contenteditable` element, or when Ctrl,
Meta, or Alt is held.

| Key | Action |
|---|---|
| `Alt+S` (browser command) | Pause / resume |
| `Space` | Pause / resume (default page scroll is prevented) |
| `=` or `+` | Faster |
| `-` or `_` | Slower |
| `Esc` | Turn off completely (stop, remove badge, remove listeners) |

### Speed

- Unit: pixels per second.
- Default 60, step 10, minimum 10, maximum 400.
- A single global value saved in `chrome.storage.local` under the key `speed`,
  written on every change and read before scrolling starts.

### Badge

A small pill fixed to the bottom-right corner of the viewport.

| Engine state | Text |
|---|---|
| running, holding, end-wait | `▶ 60` |
| paused | `❚❚ 60` |
| ended | `■ End` |

- A `<manga-scroll-badge>` element appended to `<html>` (not `<body>`,
  whose transforms would break `position: fixed`), with an open shadow root
  so site CSS cannot restyle the pill.
- `▶` is followed by U+FE0E so macOS draws it as text, not as an emoji.
- `position: fixed`, `z-index: 2147483647`, `pointer-events: none`.
- Dark translucent background, white text, thin light border so it reads on
  both white and black pages. System font, 13px.
- Fully opaque on any state change or handled key press, fading to 15%
  opacity after 2000 ms without activity.

## Architecture

Manifest V3 extension. No build step and no npm dependencies.

### Permissions

- `activeTab`: access to the current tab only after the user presses the
  shortcut or clicks the icon
- `scripting`: inject the content scripts into that tab
- `storage`: remember the speed

No host permissions.

### Files

```
manga-autoscroll/
  manifest.json
  src/background.js
  src/scroll-target.js
  src/scroller.js
  src/badge.js
  src/keys.js
  src/content.js
  scripts/make-icons.js                        (generates the icons, no deps)
  icons/icon16.png, icon48.png, icon128.png   (simple solid-color glyph)
  test/*.test.js                               (unit tests)
  test/reader.html
  test/browser-smoke.js                        (headless-Chrome smoke test)
  README.md
```

Content scripts are classic scripts injected in order:
`scroll-target.js`, `scroller.js`, `badge.js`, `keys.js`, `content.js`. The
first four attach their exports to `globalThis.MangaScroll` and also set
`module.exports` when `module` exists, so the same files load in the browser
and in Node tests.

All injected code, including the `executeScript` functions in
`background.js`, runs in the extension's isolated world. `MangaScroll` and
`window.__mangaScroll` are shared between those scripts but are invisible to
the page's own JavaScript.

### background.js (service worker)

Handles `chrome.commands.onCommand` (`toggle-scroll`) and
`chrome.action.onClicked`. For the active tab:

1. Run `() => Boolean(window.__mangaScroll)` with `chrome.scripting.executeScript`.
2. If true, run `() => window.__mangaScroll.toggle()`.
3. If false, inject the five content script files. `content.js` starts
   scrolling on load.

While a toggle is in progress for a tab, further triggers for that tab are
ignored, so a quick double press cannot inject twice.

If injection fails, for example on browser-internal pages or the extension
store, catch the error and log it. Nothing is shown to the user.

### scroll-target.js

`findScrollTarget(doc, getStyle)` returns the element to scroll.

The candidate that can scroll furthest (`scrollHeight - clientHeight`) wins,
because the strip is almost always the longest thing on the page.

1. `doc.scrollingElement` is the starting candidate and wins ties.
2. Any element can beat it if its computed `overflow-y` is `auto`, `scroll`,
   or `overlay`, it scrolls more than 50 px, `clientHeight > 0`, and its
   bounding box intersects the viewport.
3. If nothing scrolls more than 50 px, return `doc.scrollingElement`. The
   engine will reach the end and stop.

This also handles pages where a header or footer makes the document scroll
a little while the strip scrolls inside a box.

`getStyle` defaults to `getComputedStyle` and is injectable for tests.

### scroller.js: the engine

`createScroller({ target, now, requestFrame, cancelFrame, speed, onChange })`
returns an object with:

- `start()`, `pause()`, `resume()`, `toggle()`, `stop()`
- `faster()`, `slower()`, `setSpeed(n)` (clamped to 10–400)
- `userActivity()`: the user scrolled by hand; hold, then resume 1500 ms
  after the last call. Pointer presses count too. Chrome often sends no
  `pointerup` after a scrollbar drag, so there is no "hold until released".
- `getState()`, `getSpeed()`

`onChange(state, speed)` is called on every state or speed change.
An invalid speed (missing, `NaN`, non-number) becomes 60.

#### States

`running`, `paused`, `holding`, `endWait`, `ended`, `stopped`. The engine
starts in `paused`; `start()` is the same as `resume()`.

#### Each frame

Frames are requested only in `running`, `holding` and `endWait`. Entering
`paused`, `ended` or `stopped` cancels the pending frame. Entering one of the
three active states from an inactive one requests a frame and resets
`lastFrame` to `now()`.

1. `dt = min(now - lastFrame, 100)` ms. The 100 ms cap means returning from
   another tab, where `requestAnimationFrame` does not run, never causes a jump.
2. Read `actual = target.scrollTop`. If it differs from the last value the
   engine wrote by more than 3 px, something else moved the page (scroll
   anchoring, site scripts, user input). Set `pos = actual`.
3. In `holding`: write nothing. When `now >= resumeAt`, switch to `running`.
4. In `running`: `pos += speed * dt / 1000`. `pos` is a float, so slow
   speeds accumulate instead of rounding to zero. Clamp `pos` to
   `maxPos = scrollHeight - clientHeight`. Write with
   `target.scrollTo({ top: pos, behavior: 'instant' })`, which overrides any
   CSS `scroll-behavior: smooth`. Remember the written value. If
   `pos >= maxPos - 1`, enter `endWait` and record `endSince = now`.
5. In `endWait`: recompute `maxPos`. If `maxPos > pos + 1` (the page grew
   from lazy-loaded images), return to `running`. If
   `now - endSince >= 3000`, enter `ended` and stop requesting frames.

#### Transitions

- `toggle()`: `running`, `holding`, `endWait` → `paused`; `paused` or
  `ended` → `running` (re-sync `pos` to `scrollTop` and restart the frame
  loop).
  Toggling from `ended` with no new content re-enters `endWait`, then `ended`
  after 3 s.
- `userActivity()`: from `running`, `holding` or `endWait`, enter `holding`
  with `resumeAt = now + 1500`. Has no effect in `paused`, `ended` or
  `stopped`.
- `stop()`: cancel the frame loop and enter `stopped`. Terminal.

### content.js: the wiring

On load:

1. If `window.__mangaScroll` exists, do nothing. Background normally prevents
   this.
2. Find the target with `findScrollTarget`.
3. Save the target's inline `scroll-snap-type`, then set it to
   `none !important` so mandatory snap points cannot pull the page back.
4. Create the badge and the scroller (paused).
5. Expose `window.__mangaScroll = { toggle, off }` synchronously, before any
   async work, so a second injection sees it and backs off.
6. Read `speed` from storage (falling back to 60), set it, then start.

Listeners, all registered with `{ capture: true }` on `window`. Key mapping
lives in `keys.js` as `keyAction(event)`:

- `keydown`: Space, `=`/`+` and `-`/`_` act as in the key table and call
  `preventDefault()` and `stopPropagation()`, so a site's own handlers for
  those keys do not also fire. Esc calls `off()` and is left to propagate,
  so the site can still close its own menus. Arrow keys, PageUp, PageDown,
  Home and End call `userActivity()` and keep their default behavior.
- `wheel`, `touchmove`, `pointerdown`: `userActivity()`. Passive listeners.

`toggle()` checks `target.isConnected` first. If the reader replaced its
scroll box (a single-page reader loading the next chapter in place), it
calls `off()` and mounts again on the new box instead of toggling.

`off()` (Esc) stops the scroller, removes the badge and every listener,
restores the saved `scroll-snap-type`, and deletes `window.__mangaScroll`.
The next `Alt+S` injects fresh.

Speed changes are written to `chrome.storage.local`.

## Testing

### Automated (Node built-in test runner)

Run with `node --test test/`. Requires Node 18 or newer. No packages.

`scroller.test.js` uses a fake target object and a fake clock and frame
queue, and covers:

- Slow speed (10 px/s at 16 ms frames) still advances after enough frames.
- A frame gap of 5 s advances by at most `speed * 0.1` px.
- `userActivity()` stops writes, then resumes 1500 ms after the last call.
- Pointer down holds indefinitely; release resumes after 1500 ms.
- An external `scrollTop` change of more than 3 px is adopted as the new
  position without pausing.
- Reaching the bottom enters `endWait`. Growing `scrollHeight` during the
  wait resumes. No growth for 3000 ms enters `ended`.
- `toggle()` from each state lands in the state given above.
- Speed clamps at 10 and 400, steps by 10, and invalid values become 60.

`scroll-target.test.js` uses fake element objects and a fake `getStyle`, and
covers:

- A long scrolling document wins over a small scrolling box.
- The box that scrolls furthest wins.
- A strip box beats a document that only scrolls a little.
- Boxes with `overflow-y: hidden`, zero height, 50 px or less of overflow,
  or off screen are ignored.
- With no candidates, the document is returned.

`keys.test.js` covers the key table, scroll keys as activity, modifiers,
text fields and IME composition. `badge.test.js` covers the badge text.
`background.test.js` uses a fake `chrome.scripting` and covers first
injection, later toggles, a double press, and pages that refuse scripts.
`manifest.test.js` checks permissions, the shortcut, and that every
referenced file exists.

### Test page

`test/reader.html` is a self-contained fake long-strip reader, awkward on
purpose. It makes no network requests.

- The strip scrolls inside an `overflow-y: auto` box, and a footer makes the
  whole page scroll by 160 px as well.
- 12 tall CSS placeholder pages, plus 3 more appended after 2 s, to
  exercise `endWait`.
- `scroll-behavior: smooth` and `scroll-snap-type: y mandatory` on the box.
- A text box for checking that typing is not treated as keys.
- A "Next chapter" button that replaces the scroll box without a page load.
- Its own Space handler, which writes a message if it ever runs while
  auto-scroll is on.

### Browser smoke test

`test/browser-smoke.js` opens the test page in headless Google Chrome,
injects the content scripts into the page with `chrome.storage` stubbed,
and drives it through the Chrome DevTools Protocol using Node's built-in
`WebSocket`. It checks real scrolling, the badge, keys, holds, the end,
the in-place chapter change, and cleanup. Run it with
`node test/browser-smoke.js`. It is separate from `node --test` because it
needs Chrome.

### Manual checklist (in Comet)

1. Open Comet's extensions page (`chrome://extensions` should redirect),
   enable Developer mode, choose "Load unpacked", and pick the
   `manga-autoscroll` folder.
2. On the shortcuts page, confirm `Alt+S` is bound, or bind it.
3. Open `test/reader.html` from disk. If Comet blocks extensions on
   `file://` pages, enable "Allow access to file URLs" for the extension.
4. Press `Alt+S`: scrolling starts and the badge shows `▶ 60`.
5. `=` and `-` change the speed. Reload the page and press `Alt+S` again;
   the speed is remembered.
6. Space pauses and resumes. Typing in the text box does not.
7. Scroll with the trackpad: it pauses, then resumes about 1.5 s later.
   Dragging the scrollbar does the same.
8. It waits at the bottom, continues when the late pages appear, then shows
   `■ End`.
9. Click "Next chapter", press `Alt+S`: the new chapter scrolls.
10. Esc removes the badge, and the keys stop responding.
11. Repeat steps 4–10 (except 9) on a real manga site in long-strip mode.

## Done when

- `node --test test/` passes.
- `node test/browser-smoke.js` passes.
- Every item on the manual checklist passes in Comet on the test page and on
  at least one real manga site.
