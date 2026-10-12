const test = require('node:test');
const assert = require('node:assert/strict');
const { keyAction } = require('../src/keys.js');

const body = { tagName: 'BODY', isContentEditable: false };
const press = (key, extra = {}) =>
  keyAction({ key, target: body, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...extra });

test('control keys map to actions', () => {
  assert.equal(press(' '), 'toggle');
  assert.equal(press('='), 'faster');
  assert.equal(press('+'), 'faster');
  assert.equal(press('-'), 'slower');
  assert.equal(press('_'), 'slower');
  assert.equal(press('Escape'), 'off');
});

test('page-scrolling keys count as the user scrolling by hand', () => {
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
    assert.equal(press(key), 'activity', key);
  }
});

test('other keys are left alone', () => {
  for (const key of ['a', 's', 'Enter', 'Tab', 'ArrowLeft']) {
    assert.equal(press(key), null, key);
  }
});

test('keys with Ctrl, Cmd or Alt held are left alone', () => {
  assert.equal(press(' ', { ctrlKey: true }), null);
  assert.equal(press('=', { metaKey: true }), null); // Cmd+= is browser zoom
  assert.equal(press('-', { altKey: true }), null);
});

test('typing in text fields is left alone', () => {
  const fields = [
    { tagName: 'INPUT', isContentEditable: false },
    { tagName: 'TEXTAREA', isContentEditable: false },
    { tagName: 'SELECT', isContentEditable: false },
    { tagName: 'DIV', isContentEditable: true },
  ];
  for (const target of fields) {
    assert.equal(press(' ', { target }), null, target.tagName);
    assert.equal(press('ArrowDown', { target }), null, target.tagName);
  }
});

test('keys during IME composition are left alone', () => {
  assert.equal(press(' ', { isComposing: true }), null);
});
