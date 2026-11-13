# Redline

A video editor with two things on screen: the video and a timeline. You never edit by hand. You watch the cut, pin notes to moments on the timeline, press **Fix everything**, and Claude Code makes the edit and hands back a new version

Built at the AIE x MLH Hackathon @ Code Summit, November 13 2026

## How it works

1. Open a project folder. Put footage, B-roll, photos and music anywhere inside it
2. No cut yet? Describe the video in one box and press **Make the first cut**
3. Watch the cut. Press `M` where something is wrong and type what should change
4. Press **Fix everything**. Every open note goes to Claude Code in one request
5. A new version appears next to the old one. Nothing is ever overwritten
6. Happy with a version? **Export** saves it as an mp4 wherever you like. It is also already sitting in `renders/`

Redline is not a render engine. It runs the Claude Code you already have (`claude -p`) inside the project folder, with a short guide that tells it how to behave as an editor. Claude does the work with ordinary tools: ffmpeg for cuts and audio, Whisper for word timings, Remotion for titles and captions. Your own `CLAUDE.md`, skills and memory apply too, so it edits the way you taught it

```
project/
  footage/ broll/ ...   your material, read-only for Claude
  edit/                 Claude's cut list, scripts and compositions
  renders/v001.mp4      every version, never overwritten
  redline.json          your notes and the Claude session id
```

## Run it

Requirements: Node 20+, [Claude Code](https://code.claude.com/docs) logged in, `ffmpeg` on your PATH

```
npm install
npm start                 # or: npm start -- /path/to/project
npm test
```

## Keys

| Key | Action |
| --- | --- |
| `Space` | play or pause |
| `←` `→` | one second back or forward, with `Shift` one frame |
| `M` or double-click the timeline | add a note at the playhead |
| `Enter` / `Esc` | save or discard the note you are typing |
| `[` `]` | previous or next version |
| `Cmd+Enter` | fix everything |

## What Claude is allowed to do

Each run starts Claude Code with `--permission-mode acceptEdits` and `--allowedTools Bash,Read,Edit,Write,Glob,Grep`, working in the project folder. That means it can run shell commands without asking. Open only folders you trust, the same as you would with Claude Code in a terminal

## Notes

- The app is Electron for now. A native Rust shell is the plan once the workflow settles
- Remotion is free for individuals and small teams and needs a company license above that. Redline does not bundle it, Claude installs it in your project when a note needs motion graphics
- Sources for the two integration points: [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) and [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
