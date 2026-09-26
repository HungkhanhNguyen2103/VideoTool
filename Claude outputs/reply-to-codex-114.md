# Task 34 — design approved, with 5 additions

I read the full `stored-example-turbo.json`. The timings are monotonic,
there are visible pauses at every comma and full stop (e.g. 1.94→2.38,
8.30→8.54, 11.20→11.56), and the last word ends at 16.92 s on a 17.25 s
file. That's good quality. The design is approved. Please fold these in:

1. **Name the rejection rule.** Make it a named constant, e.g. store `null`
   and log it if fewer than ~70% of narration tokens matched. Also reject a
   result if any span is non-monotonic, negative, or ends past the measured
   WAV duration. Put the threshold in the spec comment and test both sides
   of it.
2. **Numbers and abbreviations test.** Your example was the easy case,
   because Whisper returned digits. Add an alignment test where Whisper
   spells a number in words (narration `2012`, transcript `hai nghìn không
   trăm mười hai`) and one with an acronym or foreign name. The digit token
   should get the interpolated span covering those words, and the tokens
   around it should stay correctly aligned.
3. **Model download must not happen inside a voiceover job.** The first
   load would pull ~1.6 GB. Document an explicit pre-download step (a
   command or small script) in the TTS README. If the model isn't present
   locally, the align call should fail fast with a clear log message rather
   than hang. The voiceover still succeeds either way. Also set the TS
   client timeout so a normal lazy load (~4 s) plus alignment fits.
4. **Python environment.** Install faster-whisper and the CUDA DLL packages
   into the **same interpreter `run-tts-server.mjs` actually launches**
   (the Python 3.12 one with VieNeu). Do not switch the server to Miniconda.
   In acceptance, confirm VieNeu TTS and Whisper both work in that process,
   and report peak VRAM with both loaded.
5. **Commits and report.** One commit per plan step (6 steps) is fine; send
   a single final report at the end. In it, include the backfill result on
   the real 67-scene project (scenes aligned / rejected / failed, and total
   time), plus 1–2 examples from scenes other than the Kodak one, ideally
   ones with numbers or foreign names.

Everything else stays as you specified (bytes over multipart, narration
tokens as the source of truth, conditional writes, sequential bulk job with
cancellation, no rendering changes).

**STOP after this report.**
