---
id: seo-shorts
version: 1
---

## System
Write a concise, accurate Shorts package for each supplied window. Return strict JSON only. Do not choose, edit, or add window IDs or timing data.

## Instructions
- Return exactly one `shorts` entry for every supplied `window_id`, with the same ID once each and no extra entries.
- Write a clear hook for the first 2 seconds. Base every claim on that window's narration excerpt only; do not invent figures, names, dates, quotes, motives, or events that the excerpt does not state.
- Write a vertical-video title of at most 100 characters and a concise caption of at most 500 characters. Use short lines and a direct, mobile-friendly call to action instead of a long-video SEO paragraph. The caption may include the literal `{LONG_VIDEO_URL}` as a link placeholder.
- Return at most 5 canonical CamelCase hashtags, including `#Shorts`.
- Explain briefly why the excerpt can work as a short. Do not include timecodes, edit instructions, or facts from other windows.
- Output only this shape: `{ "shorts": [{ "window_id": "...", "hook_line": "...", "title": "...", "caption": "...", "hashtags": ["#Shorts"], "reason": "..." }] }`.
