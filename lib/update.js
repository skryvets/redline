const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');

const run = promisify(execFile);
// Electron's fs sees app.asar as a folder and cannot delete an app bundle, so removal goes through rm
const rmrf = (target) => run('/bin/rm', ['-rf', target]);

const FEED = 'https://api.github.com/repos/skryvets/redline/releases/latest';

const parts = (version) => String(version).replace(/^v/, '').split('.').map(Number);

function isNewer(latest, current) {
  const [a, b] = [parts(latest), parts(current)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

function pickUpdate(release, current, arch) {
  const version = String(release.tag_name ?? '').replace(/^v/, '');
  if (!isNewer(version, current)) return null;
  const asset = (release.assets ?? []).find((a) => a.name.endsWith(`-${arch}-mac.zip`));
  // a release without a zip or a checksum cannot be installed safely, so it is treated as no update
  if (!asset?.digest?.startsWith('sha256:')) return null;
  return {version, url: asset.browser_download_url, sha256: asset.digest.slice(7), size: asset.size};
}

async function check(current, arch, feed = FEED) {
  const res = await fetch(feed, {headers: {Accept: 'application/vnd.github+json'}});
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return pickUpdate(await res.json(), current, arch);
}

async function install(update, appPath, onProgress = () => {}) {
  const staging = `${appPath}.update`;
  const old = `${appPath}.old`;
  const zip = path.join(staging, 'update.zip');
  await rmrf(staging);
  await fsp.mkdir(staging);
  try {
    const res = await fetch(update.url);
    if (!res.ok) throw new Error(`Download failed with ${res.status}`);
    const hash = crypto.createHash('sha256');
    const file = fs.createWriteStream(zip);
    let got = 0;
    for await (const chunk of res.body) {
      hash.update(chunk);
      if (!file.write(chunk)) await new Promise((resolve) => file.once('drain', resolve));
      got += chunk.length;
      onProgress(update.size ? got / update.size : 0);
    }
    await new Promise((resolve, reject) => file.end((err) => (err ? reject(err) : resolve())));
    if (hash.digest('hex') !== update.sha256) throw new Error('The download does not match the published checksum');
    // ditto keeps the symlinks and signatures inside the app bundle, which plain unzip libraries do not
    await run('/usr/bin/ditto', ['-x', '-k', zip, staging]);
    const fresh = path.join(staging, path.basename(appPath));
    await fsp.access(fresh);
    await rmrf(old);
    await fsp.rename(appPath, old);
    try {
      await fsp.rename(fresh, appPath);
    } catch (err) {
      await fsp.rename(old, appPath);
      throw err;
    }
    await rmrf(old);
  } finally {
    await rmrf(staging);
  }
}

module.exports = {isNewer, pickUpdate, check, install};
