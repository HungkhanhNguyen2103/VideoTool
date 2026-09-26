import os
import uuid
import asyncio
import tempfile
from pathlib import Path
import logging
import sys
import site
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Optional
from vieneu import Vieneu

app = FastAPI(title="VieNeu TTS Turbo Server - High Quality")
log = logging.getLogger("tts.align")

# Windows CTranslate2 needs these pip-installed CUDA 12/cuDNN 9 DLLs on the search path.
if sys.platform == "win32":
    for packages in site.getsitepackages():
        for relative in ("nvidia/cublas/bin", "nvidia/cudnn/bin"):
            directory = Path(packages) / relative
            if directory.is_dir():
                os.add_dll_directory(str(directory))
                os.environ["PATH"] = str(directory) + os.pathsep + os.environ.get("PATH", "")

MODEL_NAME = os.getenv("WHISPER_MODEL", "large-v3-turbo")
MODEL_PATH = Path(os.getenv("WHISPER_MODEL_PATH", str(Path(__file__).resolve().parent.parent / "data" / "models" / MODEL_NAME)))
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8_float16" if WHISPER_DEVICE == "cuda" else "int8")
whisper_model = None
whisper_device = None

def get_whisper_model():
    global whisper_model, whisper_device
    if whisper_model is not None:
        return whisper_model
    # The request path is deliberately local-only: a voiceover job must never download 1.6 GB.
    if not (MODEL_PATH / "model.bin").is_file() or not (MODEL_PATH / "config.json").is_file():
        raise RuntimeError(f"Whisper model missing at {MODEL_PATH}; pre-download it with lib/download_whisper_model.py")
    from faster_whisper import WhisperModel
    try:
        whisper_model = WhisperModel(str(MODEL_PATH), device=WHISPER_DEVICE,
                                     compute_type=WHISPER_COMPUTE_TYPE, local_files_only=True)
        whisper_device = WHISPER_DEVICE
    except Exception as error:
        if WHISPER_DEVICE != "cuda":
            raise
        log.warning("Whisper CUDA load failed; falling back to CPU/int8: %s", error)
        whisper_model = WhisperModel(str(MODEL_PATH), device="cpu", compute_type="int8", local_files_only=True)
        whisper_device = "cpu"
    log.info("Whisper ready on %s from %s", whisper_device, MODEL_PATH)
    return whisper_model

@app.post("/api/align")
async def align_audio(audio: UploadFile = File(...), text: str = Form(...)):
    global whisper_model, whisper_device
    if not text.strip():
        raise HTTPException(status_code=400, detail="Narration text is empty.")
    wav = await audio.read()
    if not wav or len(wav) > 50 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="WAV must be between 1 byte and 50 MB.")
    try:
        async with inference_lock:
            model = get_whisper_model()
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp:
                temp.write(wav)
                wav_path = temp.name
            try:
                try:
                    segments, _ = model.transcribe(wav_path, language="vi",
                                                   initial_prompt=text, word_timestamps=True)
                    words = [dict(word=w.word, start=w.start, end=w.end, probability=w.probability)
                             for segment in segments for w in (segment.words or [])]
                except Exception as error:
                    from av.error import InvalidDataError
                    if whisper_device != "cuda" or isinstance(error, InvalidDataError):
                        raise
                    log.warning("Whisper CUDA inference failed; falling back to CPU/int8: %s", error)
                    from faster_whisper import WhisperModel
                    whisper_model = WhisperModel(str(MODEL_PATH), device="cpu", compute_type="int8", local_files_only=True)
                    whisper_device = "cpu"
                    segments, _ = whisper_model.transcribe(wav_path, language="vi",
                                                           initial_prompt=text, word_timestamps=True)
                    words = [dict(word=w.word, start=w.start, end=w.end, probability=w.probability)
                             for segment in segments for w in (segment.words or [])]
            finally:
                os.remove(wav_path)
        return {"words": words}
    except Exception as error:
        log.exception("Whisper alignment failed: %s", error)
        raise HTTPException(status_code=503, detail=str(error)) from error

print("Dang nap mo hinh VieNeu-TTS v3 Turbo vao RAM...")
vieneu = Vieneu(backend="onnx")
print("He thong TTS da san sang phuc vu!")

os.makedirs("temp_audio", exist_ok=True)
inference_lock = asyncio.Lock()

class TTSRequest(BaseModel):
    text: str
    voice: str = "Truc Ly"
    ref_audio_path: Optional[str] = None
    ref_audio_text: Optional[str] = None
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    temperature: float = Field(default=0.3, ge=0.05, le=1.0)

@app.post("/api/tts")
async def generate_tts(req: TTSRequest):
    clean_text = req.text.strip()
    if not clean_text:
        raise HTTPException(status_code=400, detail="Van ban khong duoc de trong.")

    temp_file_path = f"temp_audio/{uuid.uuid4().hex}.wav"

    try:
        async with inference_lock:
            # Existing projects store the ASCII spelling; VieNeu presets use accents.
            target_voice = {"Truc Ly": "Trúc Ly"}.get(req.voice.strip(), req.voice.strip())

            if req.ref_audio_path and os.path.exists(req.ref_audio_path):
                print(f"[Python API] Dang sinh giong (Cloning) tu: {os.path.basename(req.ref_audio_path)}")
                audio = vieneu.infer(
                    text=clean_text, 
                    ref_audio=req.ref_audio_path, 
                    ref_text=req.ref_audio_text,
                    speed=req.speed,
                    temperature=req.temperature
                )
            else:
                print(f"[Python API] Dang sinh giong voi Voice Preset: {ascii(target_voice)}")
                audio = vieneu.infer(
                    text=clean_text, 
                    voice=target_voice,
                    speed=req.speed,
                    temperature=req.temperature
                )

            # Luu vao file .wav tam de vieneu nhan dien dung dinh dang am thanh
            vieneu.save(audio, temp_file_path)

            # Doc du lieu vao RAM va xoa file ngay lap tuc de giai phong dia
            with open(temp_file_path, "rb") as f:
                audio_bytes = f.read()

        try:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
        except Exception:
            pass

        return Response(content=audio_bytes, media_type="audio/wav")

    except Exception as e:
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception:
                pass
        print(f"[Python API Error]: {ascii(str(e))}")
        raise HTTPException(status_code=500, detail=str(e))
