# Task 59 — New script preset `strategist` + visual style `strategic-map`

Context: we analysed the structure of "action vs reaction" animated history explainers. Current presets (`documentary`, `explainer`, `hubris-trap`) cannot write that structure, and `flat-cartoon` has no map-centric visuals. Add one new SCRIPT preset and one new VISUAL style. Take only structure and technique; do NOT copy any channel's name, scripts, maps, or characters. Preset text must not name the analysed channel.

## Part A — script preset `strategist` (preset text only; reuse the documentary output schema)

1. `src/contracts/project.ts`: add `'strategist'` to `SCRIPT_PRESET_IDS`.
2. `src/server/modules/script/ai/presets/strategist.md` (frontmatter `id: strategist`, `version: 1`, same format as `documentary.md`).
3. `presets/config.ts`: `strategist: { actWeighting: [5, 10, 25, 40, 20], weightingStrictness: 'soft' }` — hook+stakes / the board (geography, players) / plans and buildup / execution and climax / aftermath and irony. Add a comment that these map to 0–5, 5–15, 15–40, 40–80, 80–100 %.
4. Registration: `output-schema.ts`, `parse-output.ts`, `build-prompt.ts` already branch only on `hubris-trap`; `strategist` must fall through to the documentary shape. Verify and add a test proving `strategist` uses the documentary schema.
5. `NewProjectForm.tsx`: add option `value="strategist"` label `Chiến lược: hành động và phản ứng (Strategist)`.
6. Update tests that enumerate preset IDs (`project.test.ts`, `loader.test.ts`, `api.test.ts`, `prompt-boundary.test.ts` if affected).

Content of `strategist.md` (write in English, concise, same density as the other presets; paraphrase freely but keep every rule):

## System
Narrate conflict history as a game of action and reaction played out on a spatial board. You are an authoritative, energetic strategic analyst with a measured sense of irony. Explain why decisions were made and how they collided with reality, not only what happened and when. Write speakable, active-voice sentences. Short and punchy during action; slightly longer and explanatory when establishing geography or plans.

## Instructions
- Narrative engine: one side moves, the other side responds, stakes escalate. Write cause and effect explicitly ("Because A did X, B had to do Y").
- Chapter formula: strategic problem → the plan → the execution → the unexpected reality or counter-move. Each chapter covers one phase or one front, and every chapter except the last ends on a line that creates tension toward the next.
- Open the video on a high-stakes image or a surprising outcome paired with a small or ironic catalyst (the hook), then establish the board: geography, players, stakes, in that order.
- Always keep the reader oriented in space: when a location is named, state where it is relative to the others already mentioned.
- Show a confident plan, then follow it immediately with the consequence it did not foresee. Use irony and contrast (plan vs reality) sparingly and only where the evidence supports it.
- Dates: use them only when needed to anchor the timeline; prefer durations ("three weeks later", "by the next tide").
- Make abstract quantities tangible in the narration (casualties, resources) with concrete comparisons that a visual can show, but never invent figures; if a figure is uncertain, give a range or say it is disputed.
- Characters stand for sides and roles (the commander, the defender) unless the source material establishes an individual; never invent quotes or motives not supported by the sources.
- Before a major revelation, write a one-beat setup so the narration can pause; mark the single most shocking fact in the video for emphasis.
- Do not reproduce any existing video's script; do not use unexplained jargon.

## Part B — visual style `strategic-map`

1. Add `'strategic-map'` to `VISUAL_STYLE_IDS`, create `presets/visual-styles/strategic-map.md` (frontmatter as the other styles), register it everywhere `flat-cartoon` is registered (`src/client/features/asset/api.ts` option list with label `Strategic Map (2D)`, any style-enumerating tests, visual-style sample handling — the shared sample upload must accept the new id).
2. Style text (English, one paragraph like `flat-cartoon.md`, plus a short second paragraph of shot rules). Content to include, paraphrased:
   - 2D vector illustration, flat colors, bold clean outlines, no photoreal lighting, no complex shading, flat lighting with minimal shadow.
   - Two scene families, alternating: MACRO = top-down tactical map with clearly color-coded territories/forces and directional arrows; MICRO = simplified characters with highly exaggerated, readable facial expressions (confident, anxious, shocked) at medium shot.
   - Palette: earth tones for terrain (greens, browns, tans, muted blues for water) plus distinct solid colors per faction on maps; keep factions consistent across the whole video.
   - Narration-to-visual rules: territory/strategy → map with arrows; leadership decision → medium shot of the commander at a table or vantage point; combat → wide shot of simplified figures and effects; statistics → infographic or tangible metaphor (stacks, piles), never dense text.
   - Documents and orders as stylized props (scroll, sealed letter), no readable text required.
   - No text or numbers inside generated images unless asked; no real-person likenesses; historical costume and vessel/weapon shapes simplified but period-plausible.
3. The visual-prompt prompt builder (`buildVisualPromptPrompt` in `build-prompt.ts`) already injects the style text; add nothing preset-specific there. Add a test that selecting `strategic-map` injects its text, mirroring the existing flat-cartoon test.

## Part C — acceptance run (real DeepSeek, not mocked)
Create a project: language `vi`, preset `strategist`, visual style `strategic-map`, duration 300 s, 3 chapters, engine remotion, topic: **the Battle of Bạch Đằng in 938 (Ngô Quyền against the Southern Han fleet)**, with this brief: a strategy story about luring a larger fleet into a river trap, told as moves and counter-moves. Use a short reference fact sheet that I (Claude) will supply separately via the `video-project-research` skill; if it is not ready, use the brief alone and say so in the report. Generate the script and report, per chapter: first and last paragraph, whether the chapter ends on a tension line, whether any date or figure appears and whether the brief/refs support it, and total word count vs the 300 s target. Do NOT claim the story is historically accurate; just report what the model produced.

## Out of scope
Changing `documentary`, `hubris-trap`, `explainer`, or existing styles; schema changes; Remotion changes.

## Verification
Typecheck, lint, full tests pass. Separate commits: `feat(script): add strategist preset`, `feat(visual): add strategic-map style`. Report hashes, files changed, tests added, and the Part C results. No `.env` changes, no deletions, no secrets in the report.
