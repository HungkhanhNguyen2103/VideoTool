"""Pre-download Depth Anything V2 Small for the local-only depth endpoint."""

from pathlib import Path
from huggingface_hub import snapshot_download

destination = Path(__file__).resolve().parent.parent / "data" / "models" / "depth-anything-v2-small"
destination.mkdir(parents=True, exist_ok=True)
snapshot_download(
    repo_id="depth-anything/Depth-Anything-V2-Small-hf",
    local_dir=str(destination),
    allow_patterns=["config.json", "model.safetensors", "preprocessor_config.json", "tokenizer*", "README.md"],
)
if not (destination / "model.safetensors").is_file() or not (destination / "config.json").is_file():
    raise RuntimeError(f"Incomplete Depth Anything model at {destination}")
print(f"Depth model ready: {destination}")
