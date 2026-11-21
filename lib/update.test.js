const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const update = require('./update');

const asset = (name, digest = 'sha256:abc') => ({name, digest, size: 3, browser_download_url: `https://example.test/${name}`});

test('versions compare by number, not by text', () => {
  assert.equal(update.isNewer('v0.10.0', '0.9.9'), true);
  assert.equal(update.isNewer('0.2.0', '0.2.0'), false);
  assert.equal(update.isNewer('0.1.9', '0.2.0'), false);
  assert.equal(update.isNewer('1.0', '0.9.9'), true);
});

test('an update is the newer release zip for this architecture', () => {
  const release = {tag_name: 'v0.3.0', assets: [asset('Redline-arm64.dmg'), asset('Redline-0.3.0-arm64.dmg'), asset('Redline-0.3.0-x64-mac.zip'), asset('Redline-0.3.0-arm64-mac.zip')]};
  assert.deepEqual(update.pickUpdate(release, '0.2.0', 'arm64'), {version: '0.3.0', url: 'https://example.test/Redline-0.3.0-arm64-mac.zip', sha256: 'abc', size: 3});
  assert.equal(update.pickUpdate(release, '0.3.0', 'arm64'), null);
});

test('a release without a zip or without a checksum is not an update', () => {
  assert.equal(update.pickUpdate({tag_name: 'v0.3.0', assets: [asset('Redline-0.3.0-arm64.dmg')]}, '0.2.0', 'arm64'), null);
  assert.equal(update.pickUpdate({tag_name: 'v0.3.0', assets: [asset('Redline-0.3.0-arm64-mac.zip', null)]}, '0.2.0', 'arm64'), null);
  assert.equal(update.pickUpdate({}, '0.2.0', 'arm64'), null);
});

test('install swaps the app for the downloaded one and leaves it alone when the checksum is wrong', {skip: process.platform !== 'darwin'}, async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'redline-update-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  const appPath = path.join(dir, 'Redline.app');
  await fs.mkdir(path.join(dir, 'src', 'Redline.app'), {recursive: true});
  await fs.writeFile(path.join(dir, 'src', 'Redline.app', 'version'), 'new');
  await fs.mkdir(appPath);
  await fs.writeFile(path.join(appPath, 'version'), 'old');
  const zip = path.join(dir, 'update.zip');
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', path.join(dir, 'src', 'Redline.app'), zip]);
  const bytes = await fs.readFile(zip);
  const server = http.createServer((_req, res) => res.end(bytes)).listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/update.zip`;
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');

  await assert.rejects(update.install({url, sha256: 'bad', size: bytes.length}, appPath), /checksum/);
  assert.equal(await fs.readFile(path.join(appPath, 'version'), 'utf8'), 'old');
  assert.deepEqual(await fs.readdir(dir), ['Redline.app', 'src', 'update.zip']);

  let progress = 0;
  await update.install({url, sha256, size: bytes.length}, appPath, (p) => (progress = p));
  assert.equal(await fs.readFile(path.join(appPath, 'version'), 'utf8'), 'new');
  assert.equal(progress, 1);
  assert.deepEqual(await fs.readdir(dir), ['Redline.app', 'src', 'update.zip']);
});
