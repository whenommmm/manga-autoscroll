# Manga Auto-Scroll

Hands-free reading for long-strip manga in Perplexity Comet (or any Chromium browser).
Press `CTRL+ M` on a chapter and it activates the extension.
## Install (Comet)

1. Open Comet's extensions page: type `chrome://extensions` in the address bar.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder (`manga-autoscroll`).
4. Open the extension shortcuts page (`chrome://extensions/shortcuts`) and check that
   **Start, pause or resume auto-scroll** is set to `CTRL + D`(Both on Mac and Windows. If it is
   empty, another extension took it; pick any free shortcut.

After changing the code, click the reload icon on the extension's card and reload the manga tab.

## Use

| Key | Action |
|---|---|
| `CTRL + M` or toolbar icon | Start, pause or resume |
| `CTRL + D` | Pause / resume (while it is on) |
| `=` / `-` | Faster / slower, by 10 px/s (10–400; remembered) |
| `Esc` | Turn it off |

The pill in the bottom-right corner shows the state and speed and fades after 2 seconds.
Scrolling by hand pauses it for 1.5 seconds. At the end of the chapter it waits 3 seconds
for late images, then shows `■ End`. Each new chapter page needs one `Alt+S`.

## Troubleshooting

- **Nothing happens on `CTRL + M`.** Check the shortcut on `chrome://extensions/shortcuts`.
  Browser pages (`chrome://…`, the extension store) never allow extensions.
- **Nothing happens on a local file.** On the extension's details page, turn on
  **Allow access to file URLs**.
- **It scrolls the wrong thing.** Note the site's URL: the reader probably uses a layout
  the target finder (`src/scroll-target.js`) does not expect.

## Development

```bash
node --test test/            # unit tests, no install needed (Node 18+)
node test/browser-smoke.js   # real-browser checks in headless Google Chrome
node scripts/make-icons.js   # regenerate icons
```

## Manual checklist (Comet)

The test page is a local file, so first open the extension's **Details** on
`chrome://extensions` and turn on **Allow access to file URLs**. Without it, `CTRL + M`
silently does nothing on the test page. Then open `test/reader.html` (drag it into a
Comet tab) and:

1. `CTRL + M`: scrolling starts, the pill shows `▶ 60` (or your saved speed).
2. `=` and `-` change the speed. Reload, press `CTRL + M`: the speed is remembered.
3. `CTRL + D` pauses and resumes. Typing in the text box does not, and the red
   "Site Space handler ran" message never appears while it is on.
4. Scroll with the trackpad: it pauses, then carries on about 1.5 s later.
5. Drag the scrollbar and let go: it carries on about 1.5 s later.
6. Near the bottom it waits for the late (blue) pages, then shows `■ End`.
7. Click "Next chapter", press `CTRL + M`: the new chapter scrolls.
8. `Esc` removes the pill and the keys stop responding.
9. Repeat 1–8 (except 7) on a real manga site in long-strip mode.
