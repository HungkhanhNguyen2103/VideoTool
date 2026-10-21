[CmdletBinding()]
param(
    [string]$Timeline = "timeline/spike-21s.json",
    [int]$Width = 0,
    [int]$Height = 0,
    [int]$Fps = 0,
    [double]$Start = 0,
    [double]$End = 21,
    [int]$Samples = 16,
    [ValidateSet("png", "ffmpeg")]
    [string]$Format = "ffmpeg",
    [string]$Out = "out/video/spike-21s.mp4",
    [string]$BlenderPath = $env:BLENDER_EXE
)

$ErrorActionPreference = "Stop"
$ToolRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ToolRoot)
$BuildScript = Join-Path $ToolRoot "scripts/build_scene.py"

if ([string]::IsNullOrWhiteSpace($BlenderPath)) {
    $blenderCommand = Get-Command blender.exe -ErrorAction SilentlyContinue
    if ($null -eq $blenderCommand) {
        $blenderCommand = Get-Command blender -ErrorAction SilentlyContinue
    }
    if ($null -ne $blenderCommand) {
        $BlenderPath = $blenderCommand.Source
    }
}
if ([string]::IsNullOrWhiteSpace($BlenderPath)) {
    $defaultBlender = Join-Path $env:LOCALAPPDATA "Programs/Blender Foundation/Blender 5.2/blender.exe"
    if (Test-Path -LiteralPath $defaultBlender) {
        $BlenderPath = $defaultBlender
    }
}
if ([string]::IsNullOrWhiteSpace($BlenderPath)) {
    throw "Blender was not found. Install Blender 5.2.2 LTS or pass -BlenderPath / set BLENDER_EXE."
}
if (-not (Test-Path -LiteralPath $BlenderPath)) {
    throw "Blender executable not found: $BlenderPath"
}

$TimelinePath = if ([IO.Path]::IsPathRooted($Timeline)) { $Timeline } else { Join-Path $ToolRoot $Timeline }
if (-not (Test-Path -LiteralPath $TimelinePath)) {
    throw "Timeline file not found: $TimelinePath"
}
$timelineData = Get-Content -LiteralPath $TimelinePath -Raw | ConvertFrom-Json
$Width = if ($Width -gt 0) { $Width } else { [int]$timelineData.width }
$Height = if ($Height -gt 0) { $Height } else { [int]$timelineData.height }
$Fps = if ($Fps -gt 0) { $Fps } else { [int]$timelineData.fps }
if ($End -le $Start) {
    throw "-End is exclusive and must be greater than -Start."
}
$startFrame = [int][Math]::Round($Start * $Fps) + 1
$endFrame = [int][Math]::Round($End * $Fps)
if ($endFrame -lt $startFrame) {
    throw "The selected time range does not include a frame at $Fps fps."
}

$OutputPath = if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path $ToolRoot $Out }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

if ($Format -eq "ffmpeg" -and [IO.Path]::GetExtension($OutputPath) -ne ".mp4") {
    throw "-Format ffmpeg requires an .mp4 output path."
}
$ffmpegCommand = $null
if ($Format -eq "ffmpeg") {
    $ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if ($null -eq $ffmpegCommand) {
        $ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue
    }
    if ($null -eq $ffmpegCommand) {
        throw "FFmpeg was not found on PATH; it is required to encode the Blender PNG sequence."
    }
}

$renderPath = $OutputPath
if ($Format -eq "ffmpeg" -and [IO.Path]::GetExtension($renderPath) -eq ".mp4") {
    $renderPath = [IO.Path]::ChangeExtension($renderPath, $null)
}
$scenePath = Join-Path $ToolRoot "out/spike-scene.blend"
$sceneDirectory = Split-Path -Parent $scenePath
New-Item -ItemType Directory -Force -Path $sceneDirectory | Out-Null
if (Test-Path -LiteralPath $scenePath) {
    Remove-Item -LiteralPath $scenePath -Force
}
$logDirectory = Join-Path $ToolRoot "out/logs"
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$runName = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $logDirectory "render-$runName.log"
$gpuPath = Join-Path $logDirectory "gpu-$runName.csv"

Push-Location $RepoRoot
$gpuJob = $null
try {
    $buildArgs = @(
        "-b", "--python", $BuildScript, "--",
        "--timeline", $TimelinePath,
        "--width", "$Width",
        "--height", "$Height",
        "--fps", "$Fps",
        "--samples", "$Samples",
        "--format", $Format,
        "--render-output", $renderPath,
        "--out", $scenePath
    )
    "Building scene with Blender 5.2 project settings..." | Tee-Object -FilePath $logPath
    & $BlenderPath @buildArgs 2>&1 | Tee-Object -FilePath $logPath -Append
    if ($LASTEXITCODE -ne 0) {
        throw "Blender scene build failed with exit code $LASTEXITCODE. See $logPath"
    }
    if (-not (Test-Path -LiteralPath $scenePath) -or (Get-Item -LiteralPath $scenePath).Length -eq 0) {
        throw "Blender did not produce a scene file. See $logPath"
    }

    $nvidiaSmi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
    if ($null -ne $nvidiaSmi) {
        $gpuJob = Start-Job -ArgumentList $nvidiaSmi.Source, $gpuPath -ScriptBlock {
            param($Executable, $CsvPath)
            [IO.File]::WriteAllText($CsvPath, "timestamp,memory_used_mib,gpu_utilization_percent`n")
            while ($true) {
                $sample = & $Executable --query-gpu=timestamp,memory.used,utilization.gpu --format=csv,noheader,nounits 2>$null
                if ($sample) {
                    [IO.File]::AppendAllText($CsvPath, (($sample -join "`n") + "`n"))
                }
                Start-Sleep -Milliseconds 1000
            }
        }
    }

    $renderArgs = @("-b", $scenePath, "-t", "6", "-s", "$startFrame", "-e", "$endFrame", "-a")
    "Rendering frames $startFrame-$endFrame ($Start s to $End s exclusive), $Width x $Height, $Fps fps, $Samples samples, $Format" | Tee-Object -FilePath $logPath -Append
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    & $BlenderPath @renderArgs 2>&1 | Tee-Object -FilePath $logPath -Append
    $renderExitCode = $LASTEXITCODE
    $stopwatch.Stop()
    if ($renderExitCode -ne 0) {
        throw "Blender render failed with exit code $renderExitCode. See $logPath"
    }

    $frameCount = $endFrame - $startFrame + 1
    $blenderRenderSeconds = $stopwatch.Elapsed.TotalSeconds
    $encodeSeconds = 0.0
    if ($Format -eq "ffmpeg") {
        $inputPattern = "${renderPath}%04d.png"
        $encodeArgs = @(
            "-y", "-framerate", "$Fps", "-start_number", "$startFrame",
            "-i", $inputPattern, "-frames:v", "$frameCount",
            "-c:v", "libx264", "-preset", "medium", "-crf", "22",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", $OutputPath
        )
        "Encoding $frameCount PNG frames to H.264 MP4 with system FFmpeg..." | Tee-Object -FilePath $logPath -Append
        $encodeStopwatch = [Diagnostics.Stopwatch]::StartNew()
        & $ffmpegCommand.Source @encodeArgs 2>&1 | Tee-Object -FilePath $logPath -Append
        $ffmpegExitCode = $LASTEXITCODE
        $encodeStopwatch.Stop()
        $encodeSeconds = $encodeStopwatch.Elapsed.TotalSeconds
        if ($ffmpegExitCode -ne 0) {
            throw "FFmpeg encoding failed with exit code $ffmpegExitCode. See $logPath"
        }
        if (-not (Test-Path -LiteralPath $OutputPath) -or (Get-Item -LiteralPath $OutputPath).Length -eq 0) {
            throw "FFmpeg did not produce an MP4 file. See $logPath"
        }
    }

    $secondsPerFrame = $blenderRenderSeconds / $frameCount
    "Blender render elapsed seconds: $([Math]::Round($blenderRenderSeconds, 3))" | Tee-Object -FilePath $logPath -Append
    "Frames: $frameCount; mean seconds/frame (wall time): $([Math]::Round($secondsPerFrame, 4))" | Tee-Object -FilePath $logPath -Append
    if ($Format -eq "ffmpeg") {
        "FFmpeg encode elapsed seconds: $([Math]::Round($encodeSeconds, 3))" | Tee-Object -FilePath $logPath -Append
        "Total render and encode seconds: $([Math]::Round($blenderRenderSeconds + $encodeSeconds, 3))" | Tee-Object -FilePath $logPath -Append
    }
    "Output: $OutputPath" | Tee-Object -FilePath $logPath -Append
    "GPU samples: $gpuPath" | Tee-Object -FilePath $logPath -Append
    "Log: $logPath"
}
finally {
    if ($null -ne $gpuJob) {
        Stop-Job -Job $gpuJob -ErrorAction SilentlyContinue
        Remove-Job -Job $gpuJob -Force -ErrorAction SilentlyContinue
    }
    Pop-Location
}
