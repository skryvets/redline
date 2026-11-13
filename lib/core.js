const RENDER_RE = /^v(\d+)\.mp4$/;

function listRenders(names) {
  return names
    .filter((name) => RENDER_RE.test(name))
    .sort((a, b) => Number(RENDER_RE.exec(a)[1]) - Number(RENDER_RE.exec(b)[1]));
}

function nextRenderName(names) {
  const last = listRenders(names).at(-1);
  const n = last ? Number(RENDER_RE.exec(last)[1]) + 1 : 1;
  return `v${String(n).padStart(3, '0')}.mp4`;
}

function fmtTime(sec) {
  const t = Math.round(Math.max(0, sec) * 10) / 10;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
}

function openNotes(markers, render) {
  return markers
    .filter((m) => m.render === render && !m.done && m.note.trim())
    .sort((a, b) => a.t - b.t);
}

function buildFixPrompt({render, next, notes}) {
  return [
    `Review notes on renders/${render}. Each note is pinned to a timestamp in that render.`,
    '',
    ...notes.map((m, i) => `${i + 1}. at ${fmtTime(m.t)} (${m.t.toFixed(2)}s): ${m.note.trim()}`),
    '',
    `Apply every note and write the new cut to renders/${next}. Leave everything the notes do not mention as it is.`,
  ].join('\n');
}

function buildFirstCutPrompt({brief, next}) {
  return [
    'Make the first cut of a video from the material in this folder.',
    '',
    `Brief from the director: ${brief.trim()}`,
    '',
    `Look through the folder first to see what footage, B-roll, images and audio are there. Write the cut to renders/${next}.`,
  ].join('\n');
}

function describeEvent(line) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  if (ev.type === 'system' && ev.subtype === 'init') return {sessionId: ev.session_id};
  if (ev.type === 'result') {
    return {sessionId: ev.session_id, done: true, error: Boolean(ev.is_error), summary: String(ev.result ?? '')};
  }
  if (ev.type !== 'assistant') return null;
  const block = (ev.message?.content ?? []).findLast((b) => b.type === 'text' || b.type === 'tool_use');
  if (!block) return null;
  if (block.type === 'text') return block.text.trim() ? {status: block.text.trim()} : null;
  const input = block.input ?? {};
  const detail = input.description ?? input.command ?? input.file_path ?? input.pattern ?? '';
  return {status: detail ? `${block.name}: ${detail}` : block.name};
}

const RedlineCore = {listRenders, nextRenderName, fmtTime, openNotes, buildFixPrompt, buildFirstCutPrompt, describeEvent};

// the sandboxed renderer cannot require(), so ui/index.html loads this same file as a plain script and reads RedlineCore
if (typeof module === 'object') module.exports = RedlineCore;
