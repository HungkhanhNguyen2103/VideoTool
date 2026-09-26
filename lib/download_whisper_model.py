"""Pre-download the local CTranslate2 model before starting any voiceover jobs."""

from pathlib import Path
from huggingface_hub import snapshot_download

destination = Path(__file__).resolve().parent.parent / "data" / "models" / "large-v3-turbo"
destination.mkdir(parents=True, exist_ok=True)
snapshot_download(
    repo_id="dropbox-dash/faster-whisper-large-v3-turbo",
    local_dir=str(destination),
    allow_patterns=["config.json", "model.bin", "tokenizer.json", "preprocessor_config.json", "vocabulary.*"],
)
if not (destination / "model.bin").is_file() or not (destination / "config.json").is_file():
    raise RuntimeError(f"Incomplete Whisper model at {destination}")
print(f"Whisper model ready: {destination}")
