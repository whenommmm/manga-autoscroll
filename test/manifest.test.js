const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const exists = (file) => fs.existsSync(path.join(ROOT, file));

test('manifest asks only for the three permissions in the spec', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'scripting', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
});

test('Alt+S is the suggested shortcut', () => {
  assert.equal(manifest.commands['toggle-scroll'].suggested_key.default, 'Alt+S');
});

test('every file the manifest points to exists', () => {
  const files = [
    manifest.background.service_worker,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ];
  for (const file of files) assert.ok(exists(file), file);
});

test('icons are PNGs of the size their key says', () => {
  for (const [size, file] of Object.entries(manifest.icons)) {
    const png = fs.readFileSync(path.join(ROOT, file));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', file);
    assert.equal(png.readUInt32BE(16), Number(size), `${file} width`);
    assert.equal(png.readUInt32BE(20), Number(size), `${file} height`);
  }
});
