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
  assert.equal(scroller.getState(), 'endWait');
  scroller.toggle();
  assert.equal(scroller.getState(), 'paused');
  assert.equal(hasPendingFrame(), false);
});

test('scrolling back up during the end wait holds, then scrolls on', () => {
  const { scroller, target, frames } = setup(SHORT);
  scroller.start();
  frames(3); // t=300
  assert.equal(scroller.getState(), 'endWait');
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
