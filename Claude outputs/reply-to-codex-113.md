# Task 34 — word-timing groundwork (Whisper alignment) — DESIGN FIRST

User decision: get real per-word timings by running **faster-whisper** on each
scene's voiceover (not text-based estimation). This task is **groundwork only**:
compute + store word timings. No kinetic typography rendering yet.

## Facts I've already checked
- `lib/tts_server.py` (FastAPI, VieNeu `backend="onnx"`) returns WAV bytes
  only — no timestamps.
- `tts-service.ts`: TTS → `masterAudio()` (highpass/EQ/loudnorm only — no
  trim/tempo, so timing is unchanged) → store file → `durationSec =
  ceil(probe + AUDIO_BUFFER_SECONDS)` → `patchProjectScene`.
- User's machine: Windows, i5-11400H, 24 GB RAM, **RTX 3050 Laptop 4 GB
  VRAM**.

## Decisions (please design within these)
1. **Where Whisper runs:** add a `POST /api/align` endpoint to the existing
   Python server (same process `run-tts-server.mjs` already manages). The
   Whisper model is **lazy-loaded** on the first align request, so TTS
   startup and RAM stay the same when alignment isn't used. Input: audio
   file path (or bytes) + the narration text. Use it as `initial_prompt`,
   `language="vi"`, `word_timestamps=True`. Output: raw Whisper words
   `[{word, start, end, probability}]`.
2. **Model/device:** default `large-v3-turbo` on `cuda` with
   `compute_type="int8_float16"` (should fit comfortably in 4 GB next to
   VieNeu). Automatic fallback to `cpu`/`int8` if CUDA isn't usable. Make
   model, device and compute type env-configurable. Heads-up: on Windows,
   CTranslate2 needs the CUDA 12 cuBLAS + cuDNN 9 DLLs (e.g. pip
   `nvidia-cublas-cu12`, `nvidia-cudnn-cu12`) — verify GPU really gets used
   and document the setup in AGENTS.md or the TTS README.
3. **Displayed words come from the narration, not the transcript.** Whisper
   will sometimes mis-hear Vietnamese. So the stored result is the
   **narration's own tokens**, each with timings mapped from Whisper words
   through a sequence alignment. Normalize case, punctuation and
   diacritics-insensitive matching before aligning. Narration tokens with no
   match get timings interpolated between their matched neighbours. Put this
   alignment in **TypeScript as a pure function** with unit tests.
4. **Storage:** a nullable scene field, legacy-safe default `null`, e.g.
   `wordTimings: { audioFileId: string; words: {text, startSec, endSec}[] } | null`.
   `audioFileId` records which voiceover it was computed from. Timings are
   ignored or cleared when the voiceover is regenerated or the narration is
   edited.
5. **When it runs:**
   (a) automatically right after each voiceover is generated, best-effort —
       an alignment failure must NOT fail the voiceover job, just log it;
   (b) a bulk job to backfill every scene that has a voiceover but
       missing/stale timings, since existing projects (e.g. the 67-scene one)
       already have audio. A Studio button for (b) is fine; keep UI minimal.
6. **Out of scope:** Remotion props and rendering, captions UI, FFmpeg.

## What I want back first (no implementation yet)
A short spec + task plan covering: the Python endpoint contract, the TS
client, the alignment algorithm (and its behaviour on insertions and
deletions), the schema field and invalidation rules, the job wiring (both
auto and bulk), and the test list. Also **benchmark on the real machine**:
load time, VRAM used, and seconds to align one real ~18 s scene on GPU (and
on CPU, for the fallback). Include 1 real example of the stored output next
to its narration, so I can eyeball the alignment quality.

**STOP after this report.**
