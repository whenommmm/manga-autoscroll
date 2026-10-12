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
