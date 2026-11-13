const api = window.redline;
const fmt = RedlineCore.fmtTime;
const pending = RedlineCore.openNotes;
const $ = (id) => document.getElementById(id);

const video = $('video');
const track = $('track');
const noteForm = $('note');
const noteText = $('note-text');
const statusEl = $('status');
const details = $('details');

const FRAME = 1 / 30;
const LOG_LINES = 200;

let project = null;
let markers = [];
let render = null;
let editing = null;
let running = false;
let runningSince = 0;
let log = [];

const current = () => markers.filter((m) => m.render === render).sort((a, b) => a.t - b.t);
const renderNames = () => project.renders.map((r) => r.name);
const isTyping = (el) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
const cleanError = (err) => err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function showDetails(text) {
  details.textContent = text;
  if (!text) details.hidden = true;
}

function setRender(name) {
  if (name === render) return;
  closeNote(false);
  render = name;
  const entry = project.renders.find((r) => r.name === name);
  if (entry) {
    video.src = entry.url;
    video.load();
  } else {
    video.removeAttribute('src');
  }
}

function draw() {
  const hasProject = Boolean(project);
  const hasCut = hasProject && project.renders.length > 0;
  $('welcome').hidden = hasProject;
  $('brief').hidden = !hasProject || hasCut;
  $('deck').hidden = !hasProject;
  video.hidden = !hasCut;
  if (!hasProject) return;

  $('project').textContent = project.name;
  $('brief-title').textContent = project.name;
  $('brief-text').disabled = running;
  $('brief-go').disabled = running;
  for (const id of ['version', 'time', 'add', 'timeline']) $(id).hidden = !hasCut;

  const select = $('version');
  select.replaceChildren(...project.renders.map((r) => new Option(r.name.replace('.mp4', ''), r.name, false, r.name === render)));

  const open = hasCut ? pending(markers, render).length : 0;
  const fix = $('fix');
  fix.hidden = !running && !hasCut;
  fix.textContent = running ? 'Stop' : open ? `Fix everything (${open})` : 'Fix everything';
  fix.disabled = !running && open === 0;
  $('add').disabled = running;
  statusEl.classList.toggle('busy', running);
  drawPins();
}

function drawPins() {
  const duration = video.duration;
  const pins = Number.isFinite(duration) && duration > 0 ? current() : [];
  $('pins').replaceChildren(
    ...pins.map((m, i) => {
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = `pin${m.done ? ' done' : ''}${m.id === editing ? ' active' : ''}`;
      pin.style.left = `${(m.t / duration) * 100}%`;
      pin.textContent = i + 1;
      pin.title = `${fmt(m.t)}  ${m.note}${m.done ? `  (fixed in ${m.fixedIn.replace('.mp4', '')})` : ''}`;
      pin.setAttribute('aria-label', `Note ${i + 1} at ${fmt(m.t)}`);
      pin.addEventListener('click', () => {
        video.pause();
        video.currentTime = m.t;
        openNote(m.id);
      });
      return pin;
    }),
  );
}

async function save() {
  try {
    await api.saveMarkers(markers);
  } catch (err) {
    setStatus(`Could not save notes: ${cleanError(err)}`, 'error');
    throw err;
  }
}

function openNote(id) {
  if (editing && editing !== id) closeNote(true);
  const marker = markers.find((m) => m.id === id);
  editing = id;
  noteText.value = marker.note;
  noteText.readOnly = marker.done || running;
  noteForm.hidden = false;
  const width = noteForm.offsetWidth;
  const x = (marker.t / video.duration) * track.offsetWidth;
  noteForm.style.left = `${Math.max(0, Math.min(x - width / 2, track.offsetWidth - width))}px`;
  noteText.focus();
  drawPins();
}

function closeNote(keep) {
  if (!editing) return;
  const marker = markers.find((m) => m.id === editing);
  editing = null;
  noteForm.hidden = true;
  if (marker && !marker.done && !noteText.readOnly) {
    const text = keep ? noteText.value.trim() : marker.note;
    const changed = text !== marker.note;
    if (!text) markers = markers.filter((m) => m !== marker);
    else marker.note = text;
    if (changed || !text) {
      save().then(() => changed && text && setStatus(`Note saved at ${fmt(marker.t)}`), () => {});
    }
  }
  draw();
}

function addNote() {
  if (running || !Number.isFinite(video.duration)) return;
  video.pause();
  closeNote(true);
  const marker = {id: crypto.randomUUID(), t: video.currentTime, note: '', render, done: false};
  markers.push(marker);
  drawPins();
  openNote(marker.id);
}

async function deleteNote() {
  const marker = markers.find((m) => m.id === editing);
  if (!marker || marker.done || running) return;
  if (marker.note && !confirm(`Delete the note at ${fmt(marker.t)}?`)) {
    noteText.focus();
    return;
  }
  noteText.value = '';
  closeNote(true);
  if (marker.note) setStatus(`Note at ${fmt(marker.t)} deleted`);
}

async function startRun(request) {
  closeNote(true);
  try {
    await api.start(request);
  } catch (err) {
    setStatus(cleanError(err), 'error');
    return;
  }
  running = true;
  runningSince = Date.now();
  log = [];
  showDetails('');
  setStatus('Claude is starting');
  draw();
}

async function fixOrStop() {
  if (!running) return startRun({render});
  if (confirm('Stop Claude? This round of edits will be thrown away')) await api.stop();
}

async function refresh(select) {
  project = await api.loadProject();
  if (project) {
    markers = project.markers;
    running = project.runningSince !== null;
    if (running) runningSince = project.runningSince;
    const names = renderNames();
    setRender(names.includes(select) ? select : names.includes(render) ? render : names.at(-1) ?? null);
  }
  draw();
}

function onEvent(ev) {
  if (ev.type === 'status') {
    log.push(ev.text);
    log = log.slice(-LOG_LINES);
    setStatus(ev.text.split('\n')[0], 'busy');
    if (!details.hidden) showDetails(log.join('\n'));
    return;
  }
  running = false;
  refresh(ev.render).then(() => {
    if (ev.ok) {
      setStatus(`${ev.render.replace('.mp4', '')} is ready. ${ev.summary.split('\n')[0]}`);
      showDetails(ev.summary);
      video.play().catch(() => {});
    } else {
      setStatus(ev.error.split('\n')[0], 'error');
      showDetails([ev.error, ...log].join('\n'));
    }
  });
}

function seek(event) {
  const box = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min((event.clientX - box.left) / box.width, 1));
  if (Number.isFinite(video.duration)) video.currentTime = ratio * video.duration;
}

function stepVersion(by) {
  const names = renderNames();
  const next = names[names.indexOf(render) + by];
  if (next) {
    setRender(next);
    draw();
  }
}

function tick() {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const ratio = duration ? `${(video.currentTime / duration) * 100}%` : '0';
  $('playhead').style.left = ratio;
  $('played').style.width = ratio;
  $('time').textContent = `${fmt(video.currentTime)} / ${fmt(duration)}`;
  $('elapsed').hidden = !running;
  if (running) {
    const seconds = Math.floor((Date.now() - runningSince) / 1000);
    $('elapsed').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
  requestAnimationFrame(tick);
}

const togglePlay = () => (video.paused ? video.play().catch(() => {}) : video.pause());

video.addEventListener('loadedmetadata', drawPins);
video.addEventListener('click', togglePlay);
video.addEventListener('error', () => {
  if (video.src) setStatus(`Could not play ${render}`, 'error');
});

track.addEventListener('pointerdown', (event) => {
  if (event.target.closest('.pin')) return;
  track.setPointerCapture(event.pointerId);
  seek(event);
});
track.addEventListener('pointermove', (event) => {
  if (track.hasPointerCapture(event.pointerId)) seek(event);
});
track.addEventListener('dblclick', (event) => {
  if (!event.target.closest('.pin')) addNote();
});

noteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  closeNote(true);
});
noteForm.addEventListener('focusout', (event) => {
  if (!noteForm.contains(event.relatedTarget) && document.hasFocus()) closeNote(true);
});
noteText.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeNote(false);
});
$('note-delete').addEventListener('click', deleteNote);

$('open').addEventListener('click', openProject);
$('project').addEventListener('click', openProject);
$('add').addEventListener('click', addNote);
$('fix').addEventListener('click', fixOrStop);
$('version').addEventListener('change', (event) => {
  setRender(event.target.value);
  draw();
});
statusEl.addEventListener('click', () => {
  if (running) showDetails(log.join('\n'));
  details.hidden = !details.hidden || !details.textContent;
});
$('brief').addEventListener('submit', (event) => {
  event.preventDefault();
  startRun({brief: $('brief-text').value});
});

async function openProject() {
  try {
    if (await api.openProject()) {
      render = null;
      setStatus('');
      showDetails('');
      await refresh();
    }
  } catch (err) {
    setStatus(cleanError(err), 'error');
  }
}

document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && project?.renders.length) {
    event.preventDefault();
    fixOrStop();
    return;
  }
  if (isTyping(event.target) || event.metaKey || event.ctrlKey || video.hidden) return;
  const step = event.shiftKey ? FRAME : 1;
  const keys = {
    ' ': togglePlay,
    ArrowLeft: () => (video.currentTime -= step),
    ArrowRight: () => (video.currentTime += step),
    m: addNote,
    M: addNote,
    '[': () => stepVersion(-1),
    ']': () => stepVersion(1),
  };
  if (keys[event.key]) {
    event.preventDefault();
    keys[event.key]();
  }
});

window.addEventListener('focus', () => {
  if (!editing && !running) refresh();
});

api.onEvent(onEvent);
refresh().then(() => {
  if (running) setStatus('Claude is working', 'busy');
});
tick();
