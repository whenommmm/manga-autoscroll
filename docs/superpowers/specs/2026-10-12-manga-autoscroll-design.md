# Manga Auto-Scroll: Design

Date: 2026-10-12
Status: Approved in conversation, awaiting written-spec review

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

- Rendered inside a Shadow DOM so site CSS cannot restyle it.
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
  src/content.js
  icons/icon16.png, icon48.png, icon128.png   (simple solid-color glyph)
  test/scroll-target.test.js
  test/scroller.test.js
  test/reader.html
```

Content scripts are classic scripts injected in order:
`scroll-target.js`, `scroller.js`, `badge.js`, `content.js`. The first three
attach their exports to `globalThis.MangaScroll` and also set
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
3. If false, inject the four content script files. `content.js` starts
   scrolling on load.

If injection fails, for example on browser-internal pages or the extension
store, catch the error and log it. Nothing is shown to the user.

### scroll-target.js

`findScrollTarget(doc, getStyle)` returns the element to scroll.

1. If `doc.scrollingElement.scrollHeight - clientHeight > 50`, return
   `doc.scrollingElement`.
2. Otherwise, consider every element whose computed `overflow-y` is `auto`,
   `scroll`, or `overlay`, with `scrollHeight - clientHeight > 50` and
   `clientHeight > 0`. Return the one with the largest
   `clientWidth * clientHeight`.
3. If none qualifies, return `doc.scrollingElement`. The engine will reach
   the end and stop.

`getStyle` defaults to `getComputedStyle` and is injectable for tests.

### scroller.js: the engine

`createScroller({ target, now, requestFrame, cancelFrame, speed, onChange })`
returns an object with:

- `start()`, `pause()`, `resume()`, `toggle()`, `stop()`
- `faster()`, `slower()`, `setSpeed(n)` (clamped to 10–400)
- `userActivity()`: the user scrolled by hand; hold, then resume 1500 ms later
- `setPointerDown(isDown)`: hold while a pointer is down; release acts like
  `userActivity()`
- `getState()`, `getSpeed()`

`onChange(state, speed)` is called on every state or speed change.

#### States

`running`, `paused`, `holding`, `endWait`, `ended`, `stopped`.

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
3. In `holding`: write nothing. When the pointer is not down and
   `now >= resumeAt`, switch to `running`.
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
3. Save the target's inline `scroll-snap-type`, then set it to `none` so
   mandatory snap points cannot pull the page back.
4. Read `speed` from storage, falling back to 60.
5. Create the badge and the scroller, then start.
6. Expose `window.__mangaScroll = { toggle, off }`.

Listeners, all registered with `{ capture: true }` on `window`:

- `keydown`: handle Space, `=`/`+`, `-`/`_` and Esc as in the key table.
  Arrow keys, PageUp, PageDown, Home and End call `userActivity()` and keep
  their default behavior.
- `wheel`, `touchmove`: `userActivity()`. Passive listeners.
- `pointerdown`: `setPointerDown(true)`. `pointerup` and `pointercancel`:
  `setPointerDown(false)`. This covers dragging the scrollbar.

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
- Speed clamps at 10 and 400, and steps by 10.

`scroll-target.test.js` uses fake element objects and a fake `getStyle`, and
covers:

- A scrollable document wins.
- With a non-scrolling document, the largest scrollable box wins over a
  smaller one.
- Boxes with `overflow-y: hidden`, zero height, or under 50 px of overflow
  are ignored.
- With no candidates, the document is returned.

### Test page

`test/reader.html` is a self-contained fake long-strip reader. It makes no
network requests.

- The page body does not scroll; the strip sits inside an
  `overflow-y: auto` box.
- About 15 tall placeholder "pages" built from inline SVG or CSS, so the
  strip is long.
- The last few pages are appended after a 2 s delay, to exercise `endWait`.
- `scroll-behavior: smooth` is set on the scroll box.
- A text box at the top for checking that typing is not treated as keys.

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
8. It waits at the bottom, continues when the late pages appear, then shows
   `■ End`.
9. Esc removes the badge, and the keys stop responding.
10. Repeat steps 4–9 on a real manga site in long-strip mode.

## Done when

- `node --test test/` passes.
- Every item on the manual checklist passes in Comet on the test page and on
  at least one real manga site.
