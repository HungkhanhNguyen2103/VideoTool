import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectDetail, Scene } from '../../../contracts/project';
import { formatDurationSeconds } from '../../../contracts/scene-duration';
import { Badge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import styles from './VoiceoverListenPanel.module.css';
import {
  audioUrlWithCacheBust,
  buildVoiceoverListenQueue,
  createVoiceoverGapTimer,
  decideVoiceoverEnd,
  readVoiceoverAutoAdvancePreference,
  resetVoiceoverAudio,
  resolveVoiceoverTailSeconds,
  shouldToggleVoiceoverOnSpace,
  syncVoiceoverAudio,
  voiceoverSceneHasUnappliedTail,
  voiceoverTailWaitSeconds,
  voiceoverListenReducer,
  voiceoverSceneStatus,
  writeVoiceoverAutoAdvancePreference,
  type VoiceoverGapTimer,
  type VoiceoverListenState,
} from './voiceover-listen';

type VoiceoverListenPanelProps = {
  scenes: Scene[];
  project: Pick<ProjectDetail, 'id' | 'voiceoverVoice' | 'voiceSpeed' | 'sceneTailSec'>;
  sceneTailInput: string;
  audioUrls: Record<string, string>;
  reloadVersions: Record<string, number>;
  onRegenerate: (sceneId: string) => Promise<boolean>;
  regeneratingSceneId?: string | null;
};

const initialState: VoiceoverListenState = { currentIndex: 0, isPlaying: false, blocked: null, reloadVersion: 0 };

export function VoiceoverListenPanel({ scenes, project, sceneTailInput, audioUrls, reloadVersions, onRegenerate, regeneratingSceneId = null }: VoiceoverListenPanelProps) {
  const listenQueue = useMemo(() => buildVoiceoverListenQueue(scenes), [scenes]);
  const queueScenes = useMemo(() => listenQueue.map(({ scene }) => scene), [listenQueue]);
  const [state, dispatch] = useState(() => initialState);
  const [autoAdvance, setAutoAdvance] = useState(() => readVoiceoverAutoAdvancePreference());
  const [gapState, setGapState] = useState<{ waiting: boolean; paused: boolean; remainingMs: number }>({ waiting: false, paused: false, remainingMs: 0 });
  const [finished, setFinished] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const gapTimerRef = useRef<VoiceoverGapTimer | null>(null);
  if (!gapTimerRef.current) gapTimerRef.current = createVoiceoverGapTimer();
  const currentIndex = Math.min(state.currentIndex, Math.max(queueScenes.length - 1, 0));
  const currentScene = queueScenes[currentIndex];
  const currentStatus = currentScene ? voiceoverSceneStatus(currentScene, project) : 'missing';
  const currentAudioUrl = currentScene?.audioFileId ? audioUrls[currentScene.id] : undefined;
  const currentReloadVersion = currentScene ? (reloadVersions[currentScene.id] ?? 0) + state.reloadVersion : 0;
  const currentSrc = currentAudioUrl ? audioUrlWithCacheBust(currentAudioUrl, currentReloadVersion) : undefined;
  const currentTailSeconds = resolveVoiceoverTailSeconds(sceneTailInput, project.sceneTailSec);
  const statusLabels = useMemo(() => ({ ready: 'Đã có voiceover', missing: 'Thiếu / tạo thất bại', stale: 'Voiceover đã cũ' }), []);
  const scenesRef = useRef(queueScenes);
  const projectRef = useRef(project);
  const currentIndexRef = useRef(currentIndex);
  scenesRef.current = queueScenes;
  projectRef.current = project;
  currentIndexRef.current = currentIndex;

  useEffect(() => {
    if (queueScenes.length === 0 || state.currentIndex < queueScenes.length) return;
    dispatch((current) => ({ ...current, currentIndex: queueScenes.length - 1, isPlaying: false }));
  }, [queueScenes.length, state.currentIndex]);

  useEffect(() => {
    return () => gapTimerRef.current?.cancel();
  }, []);

  useEffect(() => {
    gapTimerRef.current?.cancel();
    setGapState({ waiting: false, paused: false, remainingMs: 0 });
    setFinished(false);
    dispatch((current) => ({ ...current, currentIndex: 0, isPlaying: false, blocked: null }));
  }, [project.id]);

  useEffect(() => {
    if (currentScene) rowRefs.current[currentScene.id]?.scrollIntoView({ block: 'nearest' });
  }, [currentScene?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    resetVoiceoverAudio(audio, currentSrc);
  }, [currentScene?.id, currentSrc]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (gapState.waiting) {
      audio.pause();
      return;
    }
    void syncVoiceoverAudio(audio, {
      isPlaying: state.isPlaying,
      status: currentScene ? currentStatus : 'missing',
      hasSource: Boolean(currentScene && currentSrc),
      onBlocked: (status) => dispatch((current) => ({ ...current, isPlaying: false, blocked: status })),
      onAutoplayRejected: () => {
        setPlaybackError('Trình duyệt không cho phép tự động phát. Hãy bấm Phát để thử lại.');
        dispatch((current) => ({ ...current, isPlaying: false }));
      },
    }).then((result) => { if (result === 'playing') setPlaybackError(null); });
  }, [gapState.waiting, state.isPlaying, currentScene?.id, currentStatus, currentSrc]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldToggleVoiceoverOnSpace(event)) return;
      event.preventDefault();
      togglePlayback();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function togglePlayback(): void {
    if (gapState.waiting) {
      if (state.isPlaying) {
        const remainingMs = gapTimerRef.current?.pause() ?? gapState.remainingMs;
        setGapState((current) => ({ ...current, paused: true, remainingMs }));
      } else {
        gapTimerRef.current?.resume();
        setGapState((current) => ({ ...current, paused: false, remainingMs: gapTimerRef.current?.getRemainingMs() ?? current.remainingMs }));
      }
      dispatch((current) => ({ ...current, isPlaying: !current.isPlaying, blocked: null }));
      return;
    }
    if (!currentScene || currentStatus !== 'ready' || !currentSrc) {
      dispatch((current) => ({ ...current, isPlaying: false, blocked: currentStatus === 'stale' ? 'stale' : 'missing' }));
      return;
    }
    if (finished && audioRef.current) {
      resetVoiceoverAudio(audioRef.current, currentSrc);
      setFinished(false);
    }
    setPlaybackError(null);
    dispatch((current) => ({ ...current, isPlaying: !current.isPlaying, blocked: null }));
  }

  function cancelGap(): void {
    gapTimerRef.current?.cancel();
    setGapState({ waiting: false, paused: false, remainingMs: 0 });
  }

  function moveNext(): void {
    if (queueScenes.length === 0) return;
    cancelGap();
    setFinished(false);
    dispatch((current) => voiceoverListenReducer(current, { type: 'next', sceneCount: queueScenes.length }));
  }

  function movePrevious(): void {
    if (queueScenes.length === 0) return;
    cancelGap();
    setFinished(false);
    dispatch((current) => voiceoverListenReducer(current, { type: 'previous', sceneCount: queueScenes.length }));
  }

  function selectScene(index: number): void {
    cancelGap();
    setFinished(false);
    dispatch((current) => voiceoverListenReducer(current, { type: 'select', index }));
  }

  function handleEnded(): void {
    const nextScene = queueScenes[currentIndex + 1];
    const nextStatus = nextScene ? voiceoverSceneStatus(nextScene, project) : null;
    const decision = decideVoiceoverEnd({
      currentIndex,
      sceneCount: queueScenes.length,
      autoAdvance,
      waitSeconds: currentScene ? voiceoverTailWaitSeconds(currentTailSeconds) : 0,
      nextStatus,
    });
    if (decision.kind === 'advance') {
      moveNext();
      return;
    }
    if (decision.kind === 'blocked') {
      cancelGap();
      setFinished(false);
      dispatch((current) => voiceoverListenReducer(current, { type: 'blocked', reason: decision.reason }));
      return;
    }
    if (decision.kind === 'wait') {
      setFinished(false);
      setGapState({ waiting: true, paused: false, remainingMs: decision.waitMs });
      gapTimerRef.current?.start(decision.waitMs, () => {
        setGapState({ waiting: false, paused: false, remainingMs: 0 });
        const nextSceneAtBoundary = scenesRef.current[currentIndexRef.current + 1];
        const nextStatusAtBoundary = nextSceneAtBoundary ? voiceoverSceneStatus(nextSceneAtBoundary, projectRef.current) : null;
        if (nextStatusAtBoundary === 'missing' || nextStatusAtBoundary === 'stale') {
          dispatch((current) => voiceoverListenReducer(current, { type: 'blocked', reason: nextStatusAtBoundary }));
          return;
        }
        dispatch((current) => voiceoverListenReducer(current, { type: 'next', sceneCount: scenesRef.current.length }));
      });
      return;
    }
    cancelGap();
    dispatch((current) => voiceoverListenReducer(current, { type: 'ended' }));
    setFinished(decision.kind === 'finished');
  }

  function handleAutoAdvanceChange(enabled: boolean): void {
    setAutoAdvance(enabled);
    writeVoiceoverAutoAdvancePreference(enabled);
    if (!enabled && gapState.waiting) {
      cancelGap();
      dispatch((current) => ({ ...current, isPlaying: false }));
    }
  }

  function handleAudioCanPlay(): void {
    if (!state.isPlaying || gapState.waiting) return;
    void audioRef.current?.play().catch(() => {
      setPlaybackError('Trình duyệt không cho phép tự động phát. Hãy bấm Phát để thử lại.');
      dispatch((current) => ({ ...current, isPlaying: false }));
    });
  }

  async function regenerateCurrent(): Promise<void> {
    if (!currentScene) return;
    cancelGap();
    setFinished(false);
    dispatch((current) => ({ ...current, isPlaying: false }));
    const regenerated = await onRegenerate(currentScene.id);
    if (regenerated) dispatch((current) => voiceoverListenReducer(current, { type: 'regenerated' }));
  }

  const blockedMessage = state.blocked === 'stale'
    ? 'Voiceover scene này đã cũ vì cài đặt giọng hoặc tốc độ đã đổi.'
    : state.blocked === 'missing'
      ? 'Scene này chưa có voiceover hoặc lần tạo trước đã thất bại.'
      : null;

  return <section className={styles.panel} aria-label="Nghe voiceover">
    <label className={styles.autoAdvance}><input type="checkbox" checked={autoAdvance} onChange={(event) => handleAutoAdvanceChange(event.currentTarget.checked)} /> Tự chuyển voice kế tiếp</label>
    {gapState.waiting && <p className={styles.gapStatus} role="status">{gapState.paused ? 'Đã tạm dừng khoảng nghỉ.' : 'Đang chờ chuyển sang scene tiếp theo.'} Còn {Math.max(0, gapState.remainingMs / 1000).toFixed(2)} giây.</p>}
    {finished && <p className={styles.finished} role="status">Đã nghe hết</p>}
    <div className={styles.header}>
      <div><h3 className={styles.title}>Nghe voiceover</h3><p className={styles.muted}>Nghe lần lượt theo thứ tự scene, không kèm hình ảnh hay video.</p></div>
      <div className={styles.controls}>
        <Button size="sm" onClick={movePrevious} disabled={queueScenes.length === 0 || currentIndex === 0}>Scene trước</Button>
        <Button size="sm" variant="amber" onClick={togglePlayback} disabled={queueScenes.length === 0}>{state.isPlaying ? 'Tạm dừng' : 'Phát'}</Button>
        <Button size="sm" onClick={moveNext} disabled={queueScenes.length === 0 || currentIndex === queueScenes.length - 1}>Scene tiếp</Button>
      </div>
    </div>
    <audio ref={audioRef} className={styles.audio} src={currentSrc} preload="metadata" onEnded={handleEnded} onCanPlay={handleAudioCanPlay} onError={() => dispatch((current) => ({ ...current, isPlaying: false, blocked: currentStatus === 'stale' ? 'stale' : 'missing' }))} />
    {playbackError && <p className={styles.error} role="alert">{playbackError}</p>}
    {blockedMessage && <div className={styles.blocked} role="status"><p>{blockedMessage}</p><Button size="sm" variant="amber" disabled={regeneratingSceneId === currentScene?.id || !currentScene?.narration.trim()} onClick={() => void regenerateCurrent()}>{regeneratingSceneId === currentScene?.id ? 'Đang tạo lại…' : 'Tạo lại voice scene này'}</Button></div>}
    {currentScene && !state.isPlaying && !blockedMessage && <div className={styles.pausedAction}><span>Đang tạm dừng ở scene {listenQueue[currentIndex]?.sceneNumber}.</span><Button size="sm" variant="amber" disabled={regeneratingSceneId === currentScene.id || !currentScene.narration.trim()} onClick={() => void regenerateCurrent()}>{regeneratingSceneId === currentScene.id ? 'Đang tạo lại…' : 'Tạo lại voice scene này'}</Button></div>}
    <div className={styles.list} role="list" aria-label="Danh sách voiceover">
      {listenQueue.map(({ scene, sceneNumber }, index) => {
        const status = voiceoverSceneStatus(scene, project);
        const selected = index === currentIndex;
        return <button
          key={scene.id}
          ref={(element) => { rowRefs.current[scene.id] = element; }}
          className={`${styles.row} ${selected ? styles.selected : ''}`}
          type="button"
          role="listitem"
          aria-current={selected ? 'true' : undefined}
          onClick={() => selectScene(index)}
        >
          <span className={styles.number}>{String(sceneNumber).padStart(2, '0')}</span>
          <span className={styles.narration}>{scene.narration || 'Không có lời dẫn'}</span>
          <span className={styles.duration}>{formatDurationSeconds(scene.voiceoverDurationSec ?? scene.durationSec)}s</span>
          <Badge tone={status === 'ready' ? 'green' : status === 'stale' ? 'amber' : 'muted'}>{statusLabels[status]}</Badge>
          {voiceoverSceneHasUnappliedTail(scene, currentTailSeconds) && <span className={styles.tailBadge} title="Chưa áp dụng cho scene đã có voiceover">Chưa áp dụng tail</span>}
        </button>;
      })}
    </div>
  </section>;
}
