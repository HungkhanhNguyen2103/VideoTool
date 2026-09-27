# VieNeu TTS and Whisper alignment

`scripts/run-tts-server.mjs` runs the existing VieNeu FastAPI server. On this
Windows machine use the Python 3.12 interpreter with VieNeu installed:

```powershell
$env:TTS_PYTHON_BIN = 'C:\Users\Admin\AppData\Local\Programs\Python\Python312\python.exe'
& $env:TTS_PYTHON_BIN -m pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12 python-multipart
& $env:TTS_PYTHON_BIN lib/download_whisper_model.py
node scripts/run-tts-server.mjs
```

Run the download command **before** generating voiceovers. The model is about
1.6 GB and lives in gitignored `data/models/large-v3-turbo`. `/api/align`
loads only local files and returns HTTP 503 immediately if they are missing;
voiceover generation still succeeds and logs the alignment failure. The model
is lazy-loaded on the first alignment call, so normal TTS startup is unchanged.

`POST /api/align` accepts multipart fields `audio` (mastered WAV bytes) and
`text` (narration), and returns `{ "words": [{ "word", "start", "end",
"probability" }] }`. It uses Vietnamese word timestamps and the narration
as the initial prompt. `WHISPER_MODEL`, `WHISPER_MODEL_PATH`, `WHISPER_DEVICE`,
and `WHISPER_COMPUTE_TYPE` override the defaults (`large-v3-turbo`, local
model path, `cuda`, `int8_float16`). If CUDA loading or inference fails, the
server falls back to CPU/int8. On Windows the server adds the pip-installed
CUDA 12 cuBLAS and cuDNN 9 DLL directories to its process search path.
The existing `Truc Ly` project voice name is mapped to VieNeu's `Trúc Ly`
preset in the Python server.

## Depth Anything V2 Small

Install the depth dependencies in the same Python environment, then download
the checkpoint before using `/api/depth`:

```powershell
& $env:TTS_PYTHON_BIN -m pip install torch transformers pillow opencv-python-headless
& $env:TTS_PYTHON_BIN lib/download_depth_model.py
```

`POST /api/depth` accepts multipart `image` (JPEG, PNG, or WebP, up to 50 MB)
and returns a 16-bit grayscale PNG. `X-Depth-Score` contains the deterministic
scene score used by the Node service; the endpoint never decides eligibility.
The model is lazy-loaded, local-only, and uses CUDA when available before
falling back to CPU. It shares the existing inference lock with TTS and
Whisper.
