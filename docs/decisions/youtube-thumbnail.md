# Decisions - YouTube thumbnail button

## Whose style a thumbnail uses
**Q:** How does one button serve the owner's channel style and other people's videos?
**A:** The app ships no brand. Each run uses the person's own Claude Code, so a project `CLAUDE.md` or a personal thumbnail skill sets the style. Without one, Claude designs from that video's frames and content
**Source:** assumed default (2026-11-21)

## Where thumbnails live
**Q:** Where are thumbnails stored?
**A:** In the project at `thumbnails/thumbnail-NNN.png`, numbered and never overwritten, the same way as renders
**Source:** assumed default (2026-11-21)

## Output format
**Q:** What size and format?
**A:** PNG at 3840x2160, or 2160x3840 for vertical video, under 2 MB so it can be uploaded from a phone. Source: https://support.google.com/youtube/answer/72431
**Source:** assumed default (2026-11-21)

## Skill permission
**Q:** How can a run load a personal skill?
**A:** `Skill` is added to `--allowedTools`. The docs name the `Skill` tool but show no `--allowedTools` example for it, so this was checked with a real run. Source: https://code.claude.com/docs/en/skills
**Source:** assumed (mid-build)
