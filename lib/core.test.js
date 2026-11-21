const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('./core');

test('renders sort by version number and ignore other files', () => {
  assert.deepEqual(core.listRenders(['v010.mp4', 'notes.txt', 'v002.mp4', 'v1.mp4', 'final.mp4', 'v003.mov']), ['v1.mp4', 'v002.mp4', 'v010.mp4']);
});

test('next render name never reuses a version', () => {
  assert.equal(core.nextRenderName([]), 'v001.mp4');
  assert.equal(core.nextRenderName(['v001.mp4', 'v009.mp4']), 'v010.mp4');
  assert.equal(core.nextRenderName(['v999.mp4']), 'v1000.mp4');
});

test('time formatting carries tenths into minutes', () => {
  assert.equal(core.fmtTime(0), '0:00.0');
  assert.equal(core.fmtTime(12.34), '0:12.3');
  assert.equal(core.fmtTime(59.96), '1:00.0');
  assert.equal(core.fmtTime(125), '2:05.0');
  assert.equal(core.fmtTime(-3), '0:00.0');
});

const markers = [
  {id: 'c', t: 30, note: 'cut this pause', render: 'v002.mp4', done: false},
  {id: 'a', t: 4.5, note: '  add a title  ', render: 'v002.mp4', done: false},
  {id: 'e', t: 9, note: '   ', render: 'v002.mp4', done: false},
  {id: 'd', t: 1, note: 'already fixed', render: 'v002.mp4', done: true},
  {id: 'o', t: 2, note: 'other version', render: 'v001.mp4', done: false},
];

test('open notes are the unfinished, non-empty notes of one render in time order', () => {
  assert.deepEqual(core.openNotes(markers, 'v002.mp4').map((m) => m.id), ['a', 'c']);
});

test('fix prompt lists every open note with its timestamp and names both renders', () => {
  const prompt = core.buildFixPrompt({render: 'v002.mp4', next: 'v003.mp4', notes: core.openNotes(markers, 'v002.mp4')});
  assert.match(prompt, /notes on renders\/v002\.mp4/);
  assert.match(prompt, /1\. at 0:04\.5 \(4\.50s\): add a title\n2\. at 0:30\.0 \(30\.00s\): cut this pause/);
  assert.match(prompt, /write the new cut to renders\/v003\.mp4/);
  assert.doesNotMatch(prompt, /already fixed|other version/);
});

test('first cut prompt carries the brief and the output name', () => {
  const prompt = core.buildFirstCutPrompt({brief: ' a funny short ', next: 'v001.mp4'});
  assert.match(prompt, /Brief from the director: a funny short\n/);
  assert.match(prompt, /renders\/v001\.mp4/);
});

test('stream events map to session, status and result', () => {
  assert.deepEqual(core.describeEvent('{"type":"system","subtype":"init","session_id":"s1"}'), {sessionId: 's1'});
  assert.deepEqual(
    core.describeEvent('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ffmpeg -i a.mp4","description":"Cut the pause"}}]}}'),
    {status: 'Bash: Cut the pause'},
  );
  assert.deepEqual(core.describeEvent('{"type":"assistant","message":{"content":[{"type":"text","text":" Rendering now "}]}}'), {status: 'Rendering now'});
  assert.deepEqual(core.describeEvent('{"type":"result","is_error":false,"result":"Done","session_id":"s1"}'), {sessionId: 's1', done: true, error: false, summary: 'Done'});
  assert.equal(core.describeEvent('{"type":"system","subtype":"hook_started"}'), null);
  assert.equal(core.describeEvent('{"type":"rate_limit_event"}'), null);
  assert.equal(core.describeEvent('not json'), null);
});

test('J and L start at normal speed, double on repeat up to 8x, and reverse direction at normal speed', () => {
  assert.equal(core.shuttleRate(0, 1), 1);
  assert.equal(core.shuttleRate(1, 1), 2);
  assert.equal(core.shuttleRate(8, 1), 8);
  assert.equal(core.shuttleRate(0, -1), -1);
  assert.equal(core.shuttleRate(-2, -1), -4);
  assert.equal(core.shuttleRate(-8, -1), -8);
  assert.equal(core.shuttleRate(4, -1), -1);
  assert.equal(core.shuttleRate(-4, 1), 1);
});

test('Enter saves a note, while new line, run and IME keys do not', () => {
  assert.equal(core.submitsNote({key: 'Enter'}), true);
  assert.equal(core.submitsNote({key: 'Enter', shiftKey: true}), false);
  assert.equal(core.submitsNote({key: 'Enter', metaKey: true}), false);
  assert.equal(core.submitsNote({key: 'Enter', ctrlKey: true}), false);
  assert.equal(core.submitsNote({key: 'Enter', isComposing: true}), false);
  assert.equal(core.submitsNote({key: 'a'}), false);
});

test('a multi-line note stays inside its numbered item in the fix prompt', () => {
  const notes = [{t: 1, note: 'trim this\n2. keep the music'}];
  const prompt = core.buildFixPrompt({render: 'v001.mp4', next: 'v002.mp4', notes});
  assert.match(prompt, /1\. at .*: trim this\n   2\. keep the music/);
});

test('the saved project list drops duplicates and a current project that is not in it', () => {
  const saved = JSON.stringify({projects: ['/a', '/b', '/a', 7], current: '/b'});
  assert.deepEqual(core.readProjects(saved, '/old'), {projects: ['/a', '/b'], current: '/b'});
  assert.deepEqual(core.readProjects(JSON.stringify({projects: ['/a'], current: '/gone'})), {projects: ['/a'], current: null});
});

test('a missing or broken project list starts from the last folder of an older release', () => {
  assert.deepEqual(core.readProjects(null, '/old'), {projects: ['/old'], current: '/old'});
  assert.deepEqual(core.readProjects('{not json', '/old'), {projects: ['/old'], current: '/old'});
  assert.deepEqual(core.readProjects('{}', null), {projects: [], current: null});
});

test('adding a project keeps the list order and never lists a folder twice', () => {
  assert.deepEqual(core.addProject(['/a'], '/b'), ['/a', '/b']);
  assert.deepEqual(core.addProject(['/a', '/b'], '/a'), ['/a', '/b']);
});

test('a folder under home is shown with a tilde', () => {
  assert.equal(core.shortPath('/Users/me/Videos/short', '/Users/me'), '~/Videos/short');
  assert.equal(core.shortPath('/Users/me', '/Users/me'), '~');
  assert.equal(core.shortPath('/Users/merlin/short', '/Users/me'), '/Users/merlin/short');
  assert.equal(core.shortPath('/Volumes/SSD/short', '/Users/me'), '/Volumes/SSD/short');
});
