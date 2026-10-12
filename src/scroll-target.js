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
