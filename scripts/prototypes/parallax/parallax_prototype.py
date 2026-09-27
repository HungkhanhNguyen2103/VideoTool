"""Task 43b research prototype: depth based 2.5D parallax.

This file is intentionally outside ``src/``.  It consumes three already stored
Kodak stills, produces depth maps and comparison media, and writes a benchmark
record.  It is not imported by the application or the Remotion renderer.

The prototype uses Depth Anything V2 Small for depth, OpenCV remap for the
single-layer experiment, and a deliberately cheap OpenCV Telea inpaint for the
layer experiment.  All model loading after ``--download`` is local-only.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, DepthAnythingForDepthEstimation


REPO_ROOT = Path(__file__).resolve().parents[3]
MODEL_DIR = REPO_ROOT / "data" / "models" / "depth-anything-v2-small"
OUTPUT_DIR = REPO_ROOT / "data" / "files" / ".verification" / "task-43b"
FILES_DIR = REPO_ROOT / "data" / "files"

MODEL_ID = "depth-anything/Depth-Anything-V2-Small-hf"
FPS = 30
SECONDS = 4.5
FRAME_COUNT = int(FPS * SECONDS)
RENDER_SIZE = (1280, 720)
DEPTH_SIZE = (1920, 1080)

# The amplitudes are intentionally smaller than a music-video parallax move.
PUSH_TOTAL = 0.055
LATERAL_TOTAL = 0.025
PARALLAX_TOTAL = 18.0
LAYER_SPEEDS = (0.28, 0.62, 1.0)

SCENES = {
    "lab-engineer": {
        "label": "Lab engineer",
        "file": "01M3C1DHNZXMEXNFPFDCM8QDAR.png",
        # A person/camera edge at the right side of the frame.
        "crop": (680, 220, 1120, 690),
    },
    "boardroom": {
        "label": "Boardroom",
        "file": "01M3C1DHNKKDFD74PESW3W9380.png",
        # Near table/paper edge gives the clearest foreground boundary.
        "crop": (420, 430, 1200, 720),
    },
    "equipment": {
        "label": "Equipment / flat foreground",
        "file": "01M3C1DHP4TXS6XDYMQP18PJC4.png",
        "crop": (420, 230, 1000, 720),
    },
}


@dataclass
class SceneData:
    name: str
    label: str
    source: Path
    image: np.ndarray
    depth: np.ndarray
    depth16: np.ndarray
    crop: tuple[int, int, int, int]


def now_ms() -> float:
    return time.perf_counter() * 1000.0


def ensure_output() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def load_image(path: Path, size: tuple[int, int]) -> np.ndarray:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise FileNotFoundError(path)
    return cv2.resize(bgr, size, interpolation=cv2.INTER_AREA)


def depth_model() -> tuple[AutoImageProcessor, DepthAnythingForDepthEstimation, str, float]:
    if not MODEL_DIR.exists():
        raise RuntimeError(
            f"Missing local depth checkpoint at {MODEL_DIR}. "
            f"Run: python {Path(__file__).name} --download"
        )
    device = "cuda" if torch.cuda.is_available() else "cpu"
    started = now_ms()
    processor = AutoImageProcessor.from_pretrained(str(MODEL_DIR), local_files_only=True)
    model = DepthAnythingForDepthEstimation.from_pretrained(
        str(MODEL_DIR), local_files_only=True
    ).to(device).eval()
    if device == "cuda":
        torch.cuda.synchronize()
    return processor, model, device, now_ms() - started


def estimate_depth(
    image_bgr: np.ndarray,
    processor: AutoImageProcessor,
    model: DepthAnythingForDepthEstimation,
    device: str,
) -> tuple[np.ndarray, float]:
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    started = now_ms()
    inputs = processor(images=rgb, return_tensors="pt")
    inputs = {key: value.to(device) for key, value in inputs.items()}
    with torch.inference_mode():
        output = model(**inputs)
        predicted = torch.nn.functional.interpolate(
            output.predicted_depth.unsqueeze(1),
            size=(image_bgr.shape[0], image_bgr.shape[1]),
            mode="bicubic",
            align_corners=False,
        ).squeeze()
    if device == "cuda":
        torch.cuda.synchronize()
    depth = predicted.detach().float().cpu().numpy()
    depth -= float(depth.min())
    depth /= max(float(depth.max()), 1e-6)
    # Depth Anything produces larger values for nearer surfaces.  Keep that
    # convention: 1.0 is foreground for the layer experiment.
    return depth.astype(np.float32), now_ms() - started


def save_depth_artifacts(scene: SceneData, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(scene.depth16, mode="I;16").save(out_dir / "depth-16bit.png")
    depth8 = (scene.depth * 255.0).clip(0, 255).astype(np.uint8)
    color = cv2.applyColorMap(depth8, cv2.COLORMAP_INFERNO)
    side = np.concatenate([scene.image, color], axis=1)
    cv2.imwrite(str(out_dir / "depth-side-by-side.png"), side)


def affine_map(
    width: int,
    height: int,
    phase: float,
    depth: np.ndarray | None,
    parallax_scale: float,
    lateral_sign: float = 1.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Return inverse maps for a gentle push and optional depth displacement."""
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    zoom = 1.0 + PUSH_TOTAL * (phase + 0.5)
    cx, cy = width / 2.0, height / 2.0
    map_x = (xx - cx) / zoom + cx
    map_y = (yy - cy) / zoom + cy
    map_x -= lateral_sign * LATERAL_TOTAL * width * phase
    if depth is not None:
        centred = depth - 0.5
        map_x -= parallax_scale * centred * phase
        map_y -= parallax_scale * 0.28 * centred * phase
    return map_x, map_y


def ken_burns(scene: SceneData, frame: int) -> np.ndarray:
    phase = frame / max(FRAME_COUNT - 1, 1) - 0.5
    map_x, map_y = affine_map(*RENDER_SIZE, phase, None, 0.0, 1.0)
    return cv2.remap(scene.image, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)


def depth_displacement(scene: SceneData, frame: int) -> np.ndarray:
    phase = frame / max(FRAME_COUNT - 1, 1) - 0.5
    map_x, map_y = affine_map(*RENDER_SIZE, phase, scene.depth, PARALLAX_TOTAL, 1.0)
    # Border reflection is deliberately retained: it avoids black flashes but
    # exposes the characteristic stretched edge failure mode in A.
    return cv2.remap(scene.image, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)


def move_image(image: np.ndarray, phase: float, amount: float, speed: float) -> np.ndarray:
    map_x, map_y = affine_map(*RENDER_SIZE, phase, None, 0.0, 1.0)
    map_x -= amount * speed * phase
    map_y -= amount * 0.28 * speed * phase
    return cv2.remap(image, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)


def prepare_layers(scene: SceneData) -> tuple[list[np.ndarray], list[np.ndarray], float]:
    started = now_ms()
    depth = scene.depth
    masks = [depth < 0.38, (depth >= 0.38) & (depth < 0.68), depth >= 0.68]
    images: list[np.ndarray] = []
    layer_masks: list[np.ndarray] = []
    for mask in masks:
        mask8 = (mask.astype(np.uint8) * 255)
        # Expand the hole by a few pixels so moving boundaries do not expose a
        # dark halo. Telea is intentionally a cheap baseline, not a production
        # inpainting model.
        holes = cv2.dilate(255 - mask8, np.ones((5, 5), np.uint8), iterations=1)
        inpainted = cv2.inpaint(scene.image, holes, 3.0, cv2.INPAINT_TELEA)
        soft = cv2.GaussianBlur(mask8, (0, 0), 1.4).astype(np.float32) / 255.0
        images.append(inpainted)
        layer_masks.append(soft)
    return images, layer_masks, now_ms() - started


def layer_split(scene: SceneData, frame: int, layers: tuple[list[np.ndarray], list[np.ndarray]]) -> np.ndarray:
    images, masks = layers
    phase = frame / max(FRAME_COUNT - 1, 1) - 0.5
    canvas = np.zeros((*RENDER_SIZE[::-1], 3), dtype=np.float32)
    # Far to near.  A mask is warped with the same motion as its layer.
    for image, mask, speed in zip(images, masks, LAYER_SPEEDS):
        moved = move_image(image, phase, PARALLAX_TOTAL, speed)
        map_x, map_y = affine_map(*RENDER_SIZE, phase, None, 0.0, 1.0)
        moved_mask = cv2.remap(mask, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
        a = np.clip(moved_mask, 0.0, 1.0)[..., None]
        # Standard over operation; a foreground layer gradually replaces the
        # lower layer without exposing a seam at a soft boundary.
        canvas = moved.astype(np.float32) * a + canvas * (1.0 - a)
    return np.clip(canvas, 0, 255).astype(np.uint8)


def write_video(path: Path, frames: list[np.ndarray]) -> None:
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, FPS, RENDER_SIZE)
    if not writer.isOpened():
        raise RuntimeError(f"Could not open video writer: {path}")
    for frame in frames:
        writer.write(frame)
    writer.release()


def make_labelled(frame: np.ndarray, title: str) -> np.ndarray:
    result = frame.copy()
    cv2.rectangle(result, (0, 0), (430, 36), (12, 16, 26), -1)
    # Keep verification labels ASCII because cv2's Hershey font has no
    # Vietnamese/middle-dot glyphs and otherwise draws replacement boxes.
    cv2.putText(result, title.replace("·", "-"), (12, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 1, cv2.LINE_AA)
    return result


def save_still(path: Path, frame: np.ndarray) -> None:
    cv2.imwrite(str(path), frame)


def make_contact_sheet(scene_dir: Path, frames: dict[str, list[np.ndarray]]) -> None:
    chosen = [0, FRAME_COUNT // 2, FRAME_COUNT - 1]
    rows: list[np.ndarray] = []
    for index in chosen:
        row = np.concatenate(
            [make_labelled(frames[name][index], f"{name} · {int(index / (FRAME_COUNT - 1) * 100)}%") for name in frames],
            axis=1,
        )
        rows.append(row)
    sheet = np.concatenate(rows, axis=0)
    save_still(scene_dir / "contact-sheet-0-50-100.png", sheet)


def save_edge_crops(scene: SceneData, scene_dir: Path, frames: dict[str, list[np.ndarray]]) -> None:
    x1, y1, x2, y2 = scene.crop
    sx = RENDER_SIZE[0] / DEPTH_SIZE[0]
    sy = RENDER_SIZE[1] / DEPTH_SIZE[1]
    crop = (int(x1 * sx), int(y1 * sy), int(x2 * sx), int(y2 * sy))
    frame = FRAME_COUNT - 1
    for key, name in (("A depth displacement", "A-depth-displacement"), ("B layer inpaint", "B-layer-inpaint")):
        x1c, y1c, x2c, y2c = crop
        save_still(scene_dir / f"{name}-100-edge-crop.png", frames[key][frame][y1c:y2c, x1c:x2c])


def concat_comparison(scene_dir: Path, frames: dict[str, list[np.ndarray]]) -> None:
    # Back-to-back, with a short title card at the head of each segment.
    all_frames: list[np.ndarray] = []
    for name, name_frames in frames.items():
        all_frames.extend(make_labelled(frame, name) for frame in name_frames)
    write_video(scene_dir / "comparison-ken-burns-A-B.mp4", all_frames)


def benchmark_context() -> dict[str, Any]:
    result: dict[str, Any] = {"vieneu": {"loaded": False}, "whisper": {"loaded": False}}
    previous_offline = os.environ.get("HF_HUB_OFFLINE")
    os.environ["HF_HUB_OFFLINE"] = "1"
    try:
        from vieneu import Vieneu

        cache_root = Path.home() / ".cache" / "huggingface" / "hub" / "models--pnnbao-ump--VieNeu-TTS-v3-Turbo"
        snapshots = list((cache_root / "snapshots").glob("*") if (cache_root / "snapshots").exists() else [])
        local_graphs = [snapshot / "update" / "vieneu_prefill.onnx" for snapshot in snapshots]
        if not snapshots or not any(path.exists() for path in local_graphs):
            result["vieneu"] = {"loaded": False, "error": "local v3 turbo ONNX snapshot is not complete; skipped network download"}
        else:
            started = now_ms()
            # Never make the benchmark turn into an implicit model download.
            voice = Vieneu(mode="v3turbo", backend="onnx", local_files_only=True)
            result["vieneu"] = {"loaded": True, "load_ms": round(now_ms() - started, 1), "backend": "onnx"}
            del voice
    except Exception as error:
        result["vieneu"] = {"loaded": False, "error": str(error).splitlines()[-1]}
    try:
        from faster_whisper import WhisperModel

        whisper_path = REPO_ROOT / "data" / "models" / "large-v3-turbo"
        started = now_ms()
        whisper = WhisperModel(str(whisper_path), device="cpu", compute_type="int8", local_files_only=True)
        result["whisper"] = {"loaded": True, "load_ms": round(now_ms() - started, 1), "device": "cpu"}
        del whisper
    except Exception as error:
        result["whisper"] = {"loaded": False, "error": str(error).splitlines()[-1]}
    if previous_offline is None:
        os.environ.pop("HF_HUB_OFFLINE", None)
    else:
        os.environ["HF_HUB_OFFLINE"] = previous_offline
    return result


def benchmark_depth(
    image: np.ndarray,
    processor: AutoImageProcessor,
    model: DepthAnythingForDepthEstimation,
    device: str,
) -> dict[str, Any]:
    # Warm once, then time three identical 1920x1080 passes.
    estimate_depth(image, processor, model, device)
    if device == "cuda":
        torch.cuda.reset_peak_memory_stats()
    times: list[float] = []
    for _ in range(3):
        _, elapsed = estimate_depth(image, processor, model, device)
        times.append(elapsed)
    peak = {}
    if device == "cuda":
        peak = {
            "allocated_mb": round(torch.cuda.max_memory_allocated() / 1024**2, 1),
            "reserved_mb": round(torch.cuda.max_memory_reserved() / 1024**2, 1),
        }
    cpu_result: dict[str, Any] = {"status": "not-run"}
    # A CPU copy is a useful fallback number. It is one pass to keep the
    # prototype practical on a laptop.
    if device == "cuda":
        cpu_model = model.to("cpu")
        try:
            _, cpu_ms = estimate_depth(image, processor, cpu_model, "cpu")
            cpu_result = {"status": "ok", "per_image_ms": round(cpu_ms, 1)}
        finally:
            model.to(device)
            if device == "cuda":
                torch.cuda.empty_cache()
    return {
        "input": list(DEPTH_SIZE),
        "device": device,
        "per_image_ms": [round(value, 1) for value in times],
        "per_image_ms_mean": round(float(np.mean(times)), 1),
        "peak_vram_mb": peak,
        "cpu_fallback": cpu_result,
    }


def download_model() -> None:
    from huggingface_hub import snapshot_download

    snapshot_download(MODEL_ID, local_dir=str(MODEL_DIR), local_dir_use_symlinks=False)
    print(MODEL_DIR)


def run() -> None:
    ensure_output()
    processor, model, device, model_load_ms = depth_model()
    first_image = load_image(FILES_DIR / SCENES["lab-engineer"]["file"], DEPTH_SIZE)
    context = benchmark_context()
    depth_benchmark = benchmark_depth(first_image, processor, model, device)
    depth_benchmark["model_load_ms"] = round(model_load_ms, 1)
    depth_benchmark["context_models"] = context
    metrics: dict[str, Any] = {"model": MODEL_ID, "benchmark": depth_benchmark, "render": {}}
    print(json.dumps({"model_load_ms": model_load_ms, "benchmark": depth_benchmark}, indent=2))

    scene_data: list[SceneData] = []
    for name, spec in SCENES.items():
        source = FILES_DIR / spec["file"]
        image_depth = load_image(source, DEPTH_SIZE)
        depth, depth_ms = estimate_depth(image_depth, processor, model, device)
        render_image = cv2.resize(image_depth, RENDER_SIZE, interpolation=cv2.INTER_AREA)
        render_depth = cv2.resize(depth, RENDER_SIZE, interpolation=cv2.INTER_AREA)
        depth16 = np.rint(depth * 65535.0).clip(0, 65535).astype(np.uint16)
        scene = SceneData(name, spec["label"], source, render_image, render_depth, depth16, spec["crop"])
        scene_data.append(scene)
        scene_dir = OUTPUT_DIR / name
        save_depth_artifacts(scene, scene_dir)
        metrics["render"][name] = {"depth_ms": round(depth_ms, 1), "inpaint_ms": None, "frames": FRAME_COUNT}
        print(f"{name}: depth {depth_ms:.1f} ms")

    for scene in scene_data:
        scene_dir = OUTPUT_DIR / scene.name
        started = now_ms()
        layers, masks, inpaint_ms = prepare_layers(scene)
        metrics["render"][scene.name]["inpaint_ms"] = round(inpaint_ms, 1)
        frames: dict[str, list[np.ndarray]] = {"Ken Burns": [], "A depth displacement": [], "B layer inpaint": []}
        render_times: dict[str, float] = {}
        for name, renderer in (
            ("Ken Burns", lambda frame: ken_burns(scene, frame)),
            ("A depth displacement", lambda frame: depth_displacement(scene, frame)),
            ("B layer inpaint", lambda frame: layer_split(scene, frame, (layers, masks))),
        ):
            t0 = now_ms()
            rendered = [renderer(frame) for frame in range(FRAME_COUNT)]
            render_times[name] = round(now_ms() - t0, 1)
            frames[name] = rendered
            file_name = {
                "Ken Burns": "ken-burns.mp4",
                "A depth displacement": "A-depth-displacement.mp4",
                "B layer inpaint": "B-layer-inpaint.mp4",
            }[name]
            write_video(scene_dir / file_name, rendered)
            for index, pct in ((0, 0), (FRAME_COUNT // 2, 50), (FRAME_COUNT - 1, 100)):
                save_still(scene_dir / f"{file_name[:-4]}-{pct}.png", make_labelled(rendered[index], name))
        concat_comparison(scene_dir, frames)
        make_contact_sheet(scene_dir, frames)
        save_edge_crops(scene, scene_dir, frames)
        metrics["render"][scene.name]["render_ms"] = render_times
        metrics["render"][scene.name]["extra_vs_ken_burns_ms"] = {
            key: round(value - render_times["Ken Burns"], 1) for key, value in render_times.items()
        }
        print(f"{scene.name}: render {render_times}, inpaint {inpaint_ms:.1f} ms")

    (OUTPUT_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "README.txt").write_text(
        "Task 43b prototype outputs. Depth maps are 16-bit PNGs; comparison MP4s are back-to-back Ken Burns, A, B.\n",
        encoding="utf-8",
    )
    print(f"outputs: {OUTPUT_DIR}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--download", action="store_true", help="download the depth checkpoint once")
    return parser.parse_args()


if __name__ == "__main__":
    arguments = parse_args()
    if arguments.download:
        download_model()
    else:
        run()
