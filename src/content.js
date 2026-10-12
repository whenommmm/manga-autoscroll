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
