# Redline

A video editor with two things on screen: the video and a timeline. You never edit by hand. You watch the cut, pin notes to moments on the timeline, press **Fix**, and Claude Code makes the edit and hands back a new version

Built at the AIE x MLH Hackathon @ Code Summit, November 13 2026

## How it works

1. Add a project folder. Put footage, B-roll, photos and music anywhere inside it
2. No cut yet? Describe the video in one box and press **Make the first cut**
3. Watch the cut. Press `N` where something is wrong and type what should change
4. Press **Fix**. Every open note goes to Claude Code in one request
5. A new version appears next to the old one. Nothing is ever overwritten
6. Happy with a version? **Export** saves it as an mp4 wherever you like. It is also already sitting in `renders/`
7. Press **Create thumbnail** for a YouTube thumbnail of that version. Claude designs it from the video's content, and your own `CLAUDE.md` or thumbnail skill sets the style if you have one

Every folder you add stays in the **Projects** sidebar on the left, with its name and where it lives. Click one to switch to it, even while Claude is still working on another: a red dot marks the projects Claude is busy in. The `x` on a row takes the project off the list and leaves the folder on disk alone

Redline is not a render engine. It runs the Claude Code you already have (`claude -p`) inside the project folder, with a short guide that tells it how to behave as an editor. Claude does the work with ordinary tools: ffmpeg for cuts and audio, Whisper for word timings, Remotion for titles and captions. Your own `CLAUDE.md`, skills and memory apply too, so it edits the way you taught it

```
project/
  footage/ broll/ ...   your material, read-only for Claude
  edit/                 Claude's cut list, scripts and compositions
  renders/v001.mp4      every version, never overwritten
  thumbnails/           every YouTube thumbnail, never overwritten
  redline.json          your notes and the Claude session id
```

## Download

[Download the latest Redline for Apple silicon](https://github.com/skryvets/redline/releases/latest/download/Redline-arm64.dmg). This link always points to the newest release

Need a specific version? Every version stays on the [releases page](https://github.com/skryvets/redline/releases)

## Run it

Requirements: Node 20+, [Claude Code](https://code.claude.com/docs) logged in, `ffmpeg` on your PATH

```
npm install
npm start                 # or: npm start -- /path/to/project
npm test
npm run dist              # builds the DMG and the update zip in dist/
```

The DMG is ad-hoc signed, not notarized. It opens fine on the Mac that built it. A copy downloaded on another Mac is blocked by Gatekeeper until you allow it in System Settings

## Keys

| Key | Action |
| --- | --- |
| `Space` | play or pause |
| `←` `→` | one second back or forward, with `Shift` one frame |
| `J` `K` `L` | play backward, stop, play forward. Press `J` or `L` again to double the speed, up to 8x |
| `N`, `M` or double-click the timeline | add a note at the playhead |
| `Enter` / `Esc` | save or discard the note you are typing |
| `[` `]` | previous or next version |
| `Cmd+Enter` | fix everything |
| `Cmd+B` | show or hide the projects sidebar |

## Updates

**Redline - About Redline** shows the installed version and checks the latest [GitHub release](https://github.com/skryvets/redline/releases). **Update and restart** downloads the release zip, checks it against the SHA-256 that GitHub publishes for it, replaces the app and starts it again. Redline also checks once at launch and opens the same window when a newer version is out

The app icon is drawn in `ui/icon.svg`. `build/icon.icns` is that drawing rendered at 1024px and packed with `iconutil`, so redo it when the SVG changes

Every release needs three files from `npm run dist` attached: `Redline-<version>-arm64.dmg` for that exact version, `Redline-arm64.dmg` for the always-latest link, and `Redline-<version>-arm64-mac.zip` for the updater

The updater is hand-rolled because Electron's own updater [needs a signed app](https://www.electronjs.org/docs/latest/api/auto-updater), and these builds are only ad-hoc signed, with no Developer ID. The checksum proves the download is the file on the release, not who made it, so the trust anchor is the GitHub repository

## What Claude is allowed to do

Each run starts Claude Code with `--permission-mode acceptEdits` and `--allowedTools Bash,Read,Edit,Write,Glob,Grep,Skill`, working in the project folder. That means it can run shell commands without asking. Open only folders you trust, the same as you would with Claude Code in a terminal

## Notes

- The app is Electron for now. A native Rust shell is the plan once the workflow settles
- Remotion is free for individuals and small teams and needs a company license above that. Redline does not bundle it, Claude installs it in your project when a note needs motion graphics
- Sources for the two integration points: [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) and [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
