const {app, BrowserWindow, dialog, ipcMain, Menu} = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const readline = require('node:readline');
const {pathToFileURL} = require('node:url');
const {spawn} = require('node:child_process');
const core = require('./lib/core');
const update = require('./lib/update');

const STATE_FILE = 'redline.json';
const TOOLS = 'Bash,Read,Edit,Write,Glob,Grep,Skill';
const GUIDE = fs.readFileSync(path.join(__dirname, 'editor-guide.md'), 'utf8');
const STOP_GRACE_MS = 5000;

let win = null;
let projects = [];
let project = null;
const runs = new Map();
let stateQueue = Promise.resolve();
let updating = false;

const projectsFile = () => path.join(app.getPath('userData'), 'projects.json');
const lastProjectFile = () => path.join(app.getPath('userData'), 'last-project');
const isDir = async (dir) => Boolean((await fsp.stat(dir).catch(() => null))?.isDirectory());

function send(payload, channel = 'claude:event') {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

async function readState(dir) {
  try {
    return {sessionId: null, markers: [], ...JSON.parse(await fsp.readFile(path.join(dir, STATE_FILE), 'utf8'))};
  } catch (err) {
    if (err.code === 'ENOENT') return {sessionId: null, markers: []};
    throw err;
  }
}

function queued(work) {
  const task = stateQueue.then(work);
  stateQueue = task.catch(() => {});
  return task;
}

async function writeJson(file, value) {
  await fsp.writeFile(`${file}.tmp`, JSON.stringify(value, null, 2));
  await fsp.rename(`${file}.tmp`, file);
}

function updateState(dir, mutate) {
  return queued(async () => {
    const state = await readState(dir);
    mutate(state);
    await writeJson(path.join(dir, STATE_FILE), state);
  });
}

function saveProjects() {
  const saved = {projects, current: project};
  return queued(() => writeJson(projectsFile(), saved));
}

async function folderNames(dir, folder) {
  try {
    return await fsp.readdir(path.join(dir, folder));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

const renderNames = (dir) => folderNames(dir, 'renders');
const thumbnailNames = (dir) => folderNames(dir, 'thumbnails');

async function projectState() {
  if (!project) return null;
  const state = await readState(project);
  const renders = core.listRenders(await renderNames(project)).map((name) => ({
    name,
    url: pathToFileURL(path.join(project, 'renders', name)).href,
  }));
  const thumbnails = core.listThumbnails(await thumbnailNames(project)).map((name) => ({
    name,
    url: pathToFileURL(path.join(project, 'thumbnails', name)).href,
  }));
  return {dir: project, name: path.basename(project), renders, thumbnails, markers: state.markers, runningSince: runs.get(project)?.startedAt ?? null};
}

async function appState() {
  const home = os.homedir();
  const list = projects.map(async (dir) => ({
    dir,
    name: path.basename(dir),
    path: core.shortPath(dir, home),
    running: runs.has(dir),
    missing: !(await isDir(dir)),
  }));
  return {projects: await Promise.all(list), project: await projectState()};
}

async function openProject() {
  const {canceled, filePaths} = await dialog.showOpenDialog(win, {
    title: 'Add a project folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled) return false;
  projects = core.addProject(projects, filePaths[0]);
  project = filePaths[0];
  await saveProjects();
  return true;
}

async function selectProject(dir) {
  if (!projects.includes(dir)) throw new Error('That project is no longer in the list');
  if (!(await isDir(dir))) throw new Error(`${dir} is missing. Reconnect its drive or remove the project`);
  project = dir;
  await saveProjects();
}

async function removeProject(dir) {
  if (runs.has(dir)) throw new Error('Claude is still working on that project');
  projects = projects.filter((other) => other !== dir);
  if (project === dir) project = null;
  await saveProjects();
}

async function exportFile(folder, name, title) {
  if (!project) throw new Error('Open a project folder first');
  if (!(await folderNames(project, folder)).includes(name)) throw new Error('That file no longer exists');
  const {canceled, filePath} = await dialog.showSaveDialog(win, {
    title,
    defaultPath: path.join(app.getPath('desktop'), `${path.basename(project)}-${name}`),
  });
  if (canceled) return null;
  await fsp.copyFile(path.join(project, folder, name), filePath);
  return filePath;
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

function idleProject() {
  if (!project) throw new Error('Open a project folder first');
  if (runs.has(project)) throw new Error('Claude is already working on this project');
  if (updating) throw new Error('Redline is updating and will restart in a moment');
  return project;
}

async function startThumbnail({render, direction} = {}) {
  const dir = idleProject();
  if (!(await renderNames(dir)).includes(render)) throw new Error('That version no longer exists');
  const {sessionId} = await readState(dir);
  const thumbnail = core.nextThumbnailName(await thumbnailNames(dir));
  await fsp.mkdir(path.join(dir, 'thumbnails'), {recursive: true});
  launch({dir, prompt: core.buildThumbnailPrompt({render, next: thumbnail, direction}), thumbnail, noteIds: [], sessionId});
}

async function start({render, brief} = {}) {
  const dir = idleProject();
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
  runs.set(job.dir, current);
  readline.createInterface({input: child.stdout}).on('line', (line) => {
    const ev = core.describeEvent(line);
    if (!ev) return;
    if (ev.sessionId) current.sessionId = ev.sessionId;
    if (ev.done) Object.assign(current, {sawResult: true, summary: ev.summary, failed: ev.error});
    else if (ev.status) send({type: 'status', dir: job.dir, text: ev.status.replaceAll(`${job.dir}${path.sep}`, '')});
  });
  child.stderr.on('data', (chunk) => {
    current.stderr = (current.stderr + chunk).slice(-2000);
  });
  child.on('error', (err) => finish(current, {err}));
  child.on('close', (code) => finish(current, {code}));
}

async function finish(current, {err, code}) {
  const {job} = current;
  if (runs.get(job.dir) !== current) return;
  runs.delete(job.dir);
  clearTimeout(current.killTimer);
  // a session id that Claude Code no longer knows must not lock the project out, so retry once without it
  if (!err && code !== 0 && job.sessionId && !current.sawResult && !current.stopped) {
    launch({...job, sessionId: null});
    return;
  }
  try {
    const output = job.thumbnail ? `thumbnails/${job.thumbnail}` : `renders/${job.next}`;
    const made = (await (job.thumbnail ? thumbnailNames(job.dir) : renderNames(job.dir))).includes(path.basename(output));
    await updateState(job.dir, (state) => {
      if (current.sessionId) state.sessionId = current.sessionId;
      if (made) state.markers = state.markers.map((m) => (job.noteIds.includes(m.id) ? {...m, done: true, fixedIn: job.next} : m));
    });
    let error = null;
    if (!made) {
      if (current.stopped) error = job.thumbnail ? 'Stopped. No thumbnail was made' : 'Stopped. No new version was made';
      else if (err) error = err.code === 'ENOENT' ? 'Claude Code was not found. Install it and make sure `claude` is on your PATH' : err.message;
      else error = current.summary || current.stderr.trim() || `Claude exited with code ${code} without writing ${output}`;
    }
    send({type: 'done', dir: job.dir, ok: made, render: made && job.next ? job.next : null, thumbnail: made && job.thumbnail ? job.thumbnail : null, summary: current.summary, error});
  } catch (failure) {
    send({type: 'done', dir: job.dir, ok: false, render: null, summary: '', error: failure.message});
  }
}

function stop() {
  const current = runs.get(project);
  if (!current || current.stopped) return;
  current.stopped = true;
  // SIGINT lets Claude Code end the turn cleanly, SIGTERM is the fallback if it does not exit
  current.child.kill('SIGINT');
  current.killTimer = setTimeout(() => current.child.kill('SIGTERM'), STOP_GRACE_MS);
}

// REDLINE_UPDATE_FEED points the updater at another feed, so an update can be rehearsed without publishing a release
const checkUpdate = () => update.check(app.getVersion(), process.arch, process.env.REDLINE_UPDATE_FEED);

async function about() {
  const info = {version: app.getVersion(), update: null, error: null};
  try {
    info.update = (await checkUpdate())?.version ?? null;
  } catch (err) {
    info.error = err.message;
  }
  return info;
}

async function installUpdate() {
  if (!app.isPackaged) throw new Error('Redline is running from source. Update it with git pull');
  if (runs.size) throw new Error('Claude is still working. Update when it is done');
  if (updating) return;
  const found = await checkUpdate();
  if (!found) throw new Error('Redline is already up to date');
  updating = true;
  try {
    await update.install(found, path.resolve(process.execPath, '../../..'), (ratio) => send(ratio, 'update:progress'));
  } catch (err) {
    updating = false;
    if (['EACCES', 'EPERM', 'EROFS'].includes(err.code)) throw new Error('Redline cannot replace itself here. Move it to the Applications folder and try again');
    throw err;
  }
  app.relaunch();
  app.quit();
}

function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        {label: `About ${app.name}`, click: () => send(null, 'about:open')},
        {label: 'Check for Updates…', click: () => send(null, 'about:open')},
        {type: 'separator'},
        {role: 'hide'},
        {role: 'hideOthers'},
        {role: 'unhide'},
        {type: 'separator'},
        {role: 'quit'},
      ],
    },
    {role: 'editMenu'},
    {role: 'viewMenu'},
    {role: 'windowMenu'},
  ]));
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

async function loadProjects() {
  const read = (file) => fsp.readFile(file, 'utf8').catch(() => null);
  const saved = core.readProjects(await read(projectsFile()), await read(lastProjectFile()));
  const fromArgs = process.argv.slice(app.isPackaged ? 1 : 2).find((arg) => !arg.startsWith('-'));
  const asked = fromArgs && path.resolve(fromArgs);
  projects = saved.projects;
  if (asked && (await isDir(asked))) {
    projects = core.addProject(projects, asked);
    project = asked;
  } else if (saved.current && (await isDir(saved.current))) {
    project = saved.current;
  }
  await saveProjects();
}

app.whenReady().then(async () => {
  ipcMain.handle('project:open', openProject);
  ipcMain.handle('project:select', (_event, dir) => selectProject(String(dir)));
  ipcMain.handle('project:remove', (_event, dir) => removeProject(String(dir)));
  ipcMain.handle('project:load', appState);
  ipcMain.handle('markers:save', (_event, markers) => {
    if (!project) throw new Error('Open a project folder first');
    const clean = cleanMarkers(markers);
    return updateState(project, (state) => {
      state.markers = clean;
    });
  });
  ipcMain.handle('render:export', (_event, render) => exportFile('renders', String(render), 'Export this version'));
  ipcMain.handle('thumbnail:export', (_event, name) => exportFile('thumbnails', String(name), 'Export this thumbnail'));
  ipcMain.handle('thumbnail:start', (_event, request) => startThumbnail(request));
  ipcMain.handle('claude:start', (_event, request) => start(request));
  ipcMain.handle('claude:stop', stop);
  ipcMain.handle('about:load', about);
  ipcMain.handle('update:install', installUpdate);

  await loadProjects();
  createMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  for (const current of runs.values()) current.child.kill('SIGTERM');
});
