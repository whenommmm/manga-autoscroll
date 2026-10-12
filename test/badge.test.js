const test = require('node:test');
const assert = require('node:assert/strict');
const { badgeText } = require('../src/badge.js');

test('badge text for each state', () => {
  assert.equal(badgeText('running', 60), '▶︎ 60');
  assert.equal(badgeText('holding', 60), '▶︎ 60');
  assert.equal(badgeText('endWait', 60), '▶︎ 60');
  assert.equal(badgeText('paused', 70), '❚❚ 70');
  assert.equal(badgeText('ended', 70), '■ End');
});
