// Dev tool, not part of the app: starts the real app, runs a script in its window and records what the window shows.
//   REDLINE_EVAL    JavaScript to run in the window, may return a promise
//   REDLINE_SHOT    write a PNG of the window when the script finishes
//   REDLINE_SIZE    content size of the window, for example 1280x720
//   REDLINE_RECORD  directory for a JPEG frame sequence plus frames.txt for ffmpeg's concat demuxer
// Usage: REDLINE_SHOT=out.png npx electron scripts/drive.js /path/to/project
const {app} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

require('../main.js');

const {REDLINE_EVAL, REDLINE_SHOT, REDLINE_RECORD, REDLINE_SIZE} = process.env;
const FRAME_MS = 100;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function record(win, dir, isDone) {
  await fs.mkdir(dir, {recursive: true});
  const lines = [];
  let last = Date.now();
  for (let i = 0; !isDone(); i++) {
    const name = `f${String(i).padStart(6, '0')}.jpg`;
    await fs.writeFile(path.join(dir, name), (await win.webContents.capturePage()).toJPEG(88));
    const now = Date.now();
    if (lines.length) lines.push(`duration ${((now - last) / 1000).toFixed(3)}`);
    lines.push(`file '${name}'`);
    last = now;
    // the window can sit on one status line for minutes while Claude works, so idle time is recorded at 1 fps
    const idle = await win.webContents.executeJavaScript('window.__idle === true');
    await wait(idle ? 1000 : FRAME_MS);
  }
  lines.push('duration 0.5');
  await fs.writeFile(path.join(dir, 'frames.txt'), `${lines.join('\n')}\n`);
}

app.on('browser-window-created', (_event, win) => {
  if (REDLINE_SIZE) win.setContentSize(...REDLINE_SIZE.split('x').map(Number));
  win.webContents.once('did-finish-load', async () => {
    await wait(1500);
    let done = false;
    const recording = REDLINE_RECORD ? record(win, REDLINE_RECORD, () => done) : null;
    try {
      if (REDLINE_EVAL) console.log(await win.webContents.executeJavaScript(REDLINE_EVAL, true));
      await wait(700);
      if (REDLINE_SHOT) await fs.writeFile(REDLINE_SHOT, (await win.webContents.capturePage()).toPNG());
    } catch (err) {
      console.error(err);
      process.exitCode = 1;
    }
    done = true;
    await recording;
    app.quit();
  });
});
