const {app, BrowserWindow, dialog, ipcMain} = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const readline = require('node:readline');
const {pathToFileURL} = require('node:url');
const {spawn} = require('node:child_process');
const core = require('./lib/core');

const STATE_FILE = 'redline.json';
const TOOLS = 'Bash,Read,Edit,Write,Glob,Grep';
const GUIDE = fs.readFileSync(path.join(__dirname, 'editor-guide.md'), 'utf8');
const STOP_GRACE_MS = 5000;

let win = null;
let project = null;
let run = null;
let stateQueue = Promise.resolve();

const lastProjectFile = () => path.join(app.getPath('userData'), 'last-project');

function send(payload) {
  if (win && !win.isDestroyed()) win.webContents.send('claude:event', payload);
}

async function readState(dir) {
  try {
    return {sessionId: null, markers: [], ...JSON.parse(await fsp.readFile(path.join(dir, STATE_FILE), 'utf8'))};
  } catch (err) {
    if (err.code === 'ENOENT') return {sessionId: null, markers: []};
    throw err;
  }
}

function updateState(dir, mutate) {
  const task = stateQueue.then(async () => {
    const state = await readState(dir);
    mutate(state);
    const file = path.join(dir, STATE_FILE);
    await fsp.writeFile(`${file}.tmp`, JSON.stringify(state, null, 2));
    await fsp.rename(`${file}.tmp`, file);
  });
  stateQueue = task.catch(() => {});
  return task;
}

async function renderNames(dir) {
  try {
    return await fsp.readdir(path.join(dir, 'renders'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function projectState() {
  if (!project) return null;
  const state = await readState(project);
  const renders = core.listRenders(await renderNames(project)).map((name) => ({
    name,
    url: pathToFileURL(path.join(project, 'renders', name)).href,
  }));
  return {name: path.basename(project), renders, markers: state.markers, runningSince: run ? run.startedAt : null};
}

async function setProject(dir) {
  project = dir;
  await fsp.writeFile(lastProjectFile(), dir);
}

async function openProject() {
  const {canceled, filePaths} = await dialog.showOpenDialog(win, {
    title: 'Open a project folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled) return null;
  if (run) throw new Error('Claude is still working on the current project');
  await setProject(filePaths[0]);
  return projectState();
}

function cleanMarkers(markers) {
  if (!Array.isArray(markers)) throw new Error('Markers must be a list');
  return markers.map((m) => ({
    id: String(m.id),
    t: Number(m.t),
    note: String(m.note),
    render: String(m.render),
    done: Boolean(m.done),
    ...(m.fixedIn ? {fixedIn: String(m.fixedIn)} : {}),
  }));
}

async function start({render, brief} = {}) {
  if (!project) throw new Error('Open a project folder first');
  if (run) throw new Error('Claude is already working on this project');
  const dir = project;
  const state = await readState(dir);
  const names = await renderNames(dir);
  const next = core.nextRenderName(names);
  let prompt;
  let notes = [];
  if (core.listRenders(names).length === 0) {
    if (!String(brief ?? '').trim()) throw new Error('Describe the video first');
    prompt = core.buildFirstCutPrompt({brief: String(brief), next});
  } else {
    if (!names.includes(render)) throw new Error('That version no longer exists');
    notes = core.openNotes(state.markers, render);
    if (notes.length === 0) throw new Error('There are no notes to fix');
    prompt = core.buildFixPrompt({render, next, notes});
  }
  await fsp.mkdir(path.join(dir, 'renders'), {recursive: true});
  launch({dir, prompt, next, noteIds: notes.map((m) => m.id), sessionId: state.sessionId});
}

function launch(job) {
  const args = [
    '-p', job.prompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', TOOLS,
    '--append-system-prompt', GUIDE,
  ];
  if (job.sessionId) args.push('--resume', job.sessionId);
  // an app started from Finder gets a bare PATH that misses Homebrew and ~/.local/bin
  const PATH = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local/bin')].join(path.delimiter);
  const child = spawn('claude', args, {cwd: job.dir, stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, PATH}});
  const current = {child, job, sessionId: null, summary: '', failed: false, sawResult: false, stopped: false, stderr: '', killTimer: null, startedAt: Date.now()};
  run = current;
  readline.createInterface({input: child.stdout}).on('line', (line) => {
    const ev = core.describeEvent(line);
    if (!ev) return;
    if (ev.sessionId) current.sessionId = ev.sessionId;
    if (ev.done) Object.assign(current, {sawResult: true, summary: ev.summary, failed: ev.error});
    else if (ev.status) send({type: 'status', text: ev.status.replaceAll(`${job.dir}${path.sep}`, '')});
  });
  child.stderr.on('data', (chunk) => {
    current.stderr = (current.stderr + chunk).slice(-2000);
  });
  child.on('error', (err) => finish(current, {err}));
  child.on('close', (code) => finish(current, {code}));
}

async function finish(current, {err, code}) {
  if (run !== current) return;
  run = null;
  clearTimeout(current.killTimer);
  const {job} = current;
  // a session id that Claude Code no longer knows must not lock the project out, so retry once without it
  if (!err && code !== 0 && job.sessionId && !current.sawResult && !current.stopped) {
    launch({...job, sessionId: null});
    return;
  }
  try {
    const made = (await renderNames(job.dir)).includes(job.next);
    await updateState(job.dir, (state) => {
      if (current.sessionId) state.sessionId = current.sessionId;
      if (made) state.markers = state.markers.map((m) => (job.noteIds.includes(m.id) ? {...m, done: true, fixedIn: job.next} : m));
    });
    let error = null;
    if (!made) {
      if (current.stopped) error = 'Stopped. No new version was made';
      else if (err) error = err.code === 'ENOENT' ? 'Claude Code was not found. Install it and make sure `claude` is on your PATH' : err.message;
      else error = current.summary || current.stderr.trim() || `Claude exited with code ${code} without writing renders/${job.next}`;
    }
    send({type: 'done', ok: made, render: made ? job.next : null, summary: current.summary, error});
  } catch (failure) {
    send({type: 'done', ok: false, render: null, summary: '', error: failure.message});
  }
}

function stop() {
  if (!run || run.stopped) return;
  const current = run;
  current.stopped = true;
  // SIGINT lets Claude Code end the turn cleanly, SIGTERM is the fallback if it does not exit
  current.child.kill('SIGINT');
  current.killTimer = setTimeout(() => current.child.kill('SIGTERM'), STOP_GRACE_MS);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 375,
    minHeight: 480,
    backgroundColor: '#0c0c0e',
    title: 'Redline',
    webPreferences: {preload: path.join(__dirname, 'preload.js')},
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

async function initialProject() {
  const fromArgs = process.argv.slice(app.isPackaged ? 1 : 2).find((arg) => !arg.startsWith('-'));
  const candidates = [fromArgs && path.resolve(fromArgs), await fsp.readFile(lastProjectFile(), 'utf8').catch(() => null)];
  for (const dir of candidates) {
    if (dir && (await fsp.stat(dir).catch(() => null))?.isDirectory()) return dir;
  }
  return null;
}

app.whenReady().then(async () => {
  ipcMain.handle('project:open', openProject);
  ipcMain.handle('project:load', projectState);
  ipcMain.handle('markers:save', (_event, markers) => {
    if (!project) throw new Error('Open a project folder first');
    const clean = cleanMarkers(markers);
    return updateState(project, (state) => {
      state.markers = clean;
    });
  });
  ipcMain.handle('claude:start', (_event, request) => start(request));
  ipcMain.handle('claude:stop', stop);

  const dir = await initialProject();
  if (dir) await setProject(dir);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (run) run.child.kill('SIGTERM');
});
