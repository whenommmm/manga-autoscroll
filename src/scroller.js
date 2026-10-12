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
