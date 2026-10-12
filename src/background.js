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
