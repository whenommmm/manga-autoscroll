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
    // composedPath()[0] is the real focused element, even inside a web component.
    const origin = event.composedPath ? event.composedPath()[0] : event.target;
    if (isEditable(origin)) return null;
    if (Object.hasOwn(ACTIONS, event.key)) return ACTIONS[event.key];
    return SCROLL_KEYS.has(event.key) ? 'activity' : null;
  }

  const api = { keyAction };
  root.MangaScroll = Object.assign(root.MangaScroll || {}, api);
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
