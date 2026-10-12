import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectDetail, Scene } from '../../../contracts/project';
import { formatDurationSeconds } from '../../../contracts/scene-duration';
import { Badge } from '../../shared/ui/Badge';
import { Button } from '../../shared/ui/Button';
import styles from './VoiceoverListenPanel.module.css';
import {
  audioUrlWithCacheBust,
  resetVoiceoverAudio,
  shouldToggleVoiceoverOnSpace,
  syncVoiceoverAudio,
  voiceoverListenReducer,
  voiceoverSceneStatus,
  type VoiceoverListenState,
} from './voiceover-listen';

type VoiceoverListenPanelProps = {
  scenes: Scene[];
  project: Pick<ProjectDetail, 'voiceoverVoice' | 'voiceSpeed'>;
  audioUrls: Record<string, string>;
  reloadVersions: Record<string, number>;
  onRegenerate: (sceneId: string) => Promise<boolean>;
  regeneratingSceneId?: string | null;
};

const initialState: VoiceoverListenState = { currentIndex: 0, isPlaying: false, blocked: null, reloadVersion: 0 };

export function VoiceoverListenPanel({ scenes, project, audioUrls, reloadVersions, onRegenerate, regeneratingSceneId = null }: VoiceoverListenPanelProps) {
  const [state, dispatch] = useState(() => initialState);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const currentIndex = Math.min(state.currentIndex, Math.max(scenes.length - 1, 0));
  const currentScene = scenes[currentIndex];
  const currentStatus = currentScene ? voiceoverSceneStatus(currentScene, project) : 'missing';
  const currentAudioUrl = currentScene?.audioFileId ? audioUrls[currentScene.id] : undefined;
  const currentReloadVersion = currentScene ? reloadVersions[currentScene.id] ?? 0 : 0;
  const currentSrc = currentAudioUrl ? audioUrlWithCacheBust(currentAudioUrl, currentReloadVersion) : undefined;
  const statusLabels = useMemo(() => ({ ready: 'Đã có voiceover', missing: 'Thiếu / tạo thất bại', stale: 'Voiceover đã cũ' }), []);

  useEffect(() => {
    if (scenes.length === 0 || state.currentIndex < scenes.length) return;
    dispatch((current) => ({ ...current, currentIndex: scenes.length - 1, isPlaying: false }));
  }, [scenes.length, state.currentIndex]);

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
  }, [state.isPlaying, currentScene?.id, currentStatus, currentSrc]);

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
    if (!currentScene || currentStatus !== 'ready' || !currentSrc) {
      dispatch((current) => ({ ...current, isPlaying: false, blocked: currentStatus === 'stale' ? 'stale' : 'missing' }));
      return;
    }
    setPlaybackError(null);
    dispatch((current) => ({ ...current, isPlaying: !current.isPlaying, blocked: null }));
  }

  function moveNext(): void {
    if (scenes.length === 0) return;
    dispatch((current) => voiceoverListenReducer(current, { type: 'next', sceneCount: scenes.length }));
  }

  function movePrevious(): void {
    if (scenes.length === 0) return;
    dispatch((current) => voiceoverListenReducer(current, { type: 'previous', sceneCount: scenes.length }));
  }

  function selectScene(index: number): void {
    dispatch((current) => voiceoverListenReducer(current, { type: 'select', index }));
  }

  function handleEnded(): void {
    if (currentIndex + 1 < scenes.length) moveNext();
    else dispatch((current) => voiceoverListenReducer(current, { type: 'ended' }));
  }

  async function regenerateCurrent(): Promise<void> {
    if (!currentScene) return;
    const regenerated = await onRegenerate(currentScene.id);
    if (regenerated) dispatch((current) => voiceoverListenReducer(current, { type: 'regenerated' }));
  }

  const blockedMessage = state.blocked === 'stale'
    ? 'Voiceover scene này đã cũ vì cài đặt giọng hoặc tốc độ đã đổi.'
    : state.blocked === 'missing'
      ? 'Scene này chưa có voiceover hoặc lần tạo trước đã thất bại.'
      : null;

  return <section className={styles.panel} aria-label="Nghe voiceover">
    <div className={styles.header}>
      <div><h3 className={styles.title}>Nghe voiceover</h3><p className={styles.muted}>Nghe lần lượt theo thứ tự scene, không kèm hình ảnh hay video.</p></div>
      <div className={styles.controls}>
        <Button size="sm" onClick={movePrevious} disabled={scenes.length === 0 || currentIndex === 0}>Scene trước</Button>
        <Button size="sm" variant="amber" onClick={togglePlayback} disabled={scenes.length === 0}>{state.isPlaying ? 'Tạm dừng' : 'Phát'}</Button>
        <Button size="sm" onClick={moveNext} disabled={scenes.length === 0 || currentIndex === scenes.length - 1}>Scene tiếp</Button>
      </div>
    </div>
    <audio ref={audioRef} className={styles.audio} src={currentSrc} preload="metadata" onEnded={handleEnded} onCanPlay={() => { if (state.isPlaying) void audioRef.current?.play().catch(() => undefined); }} onError={() => dispatch((current) => ({ ...current, isPlaying: false, blocked: currentStatus === 'stale' ? 'stale' : 'missing' }))} />
    {playbackError && <p className={styles.error} role="alert">{playbackError}</p>}
    {blockedMessage && <div className={styles.blocked} role="status"><p>{blockedMessage}</p><Button size="sm" variant="amber" disabled={regeneratingSceneId === currentScene?.id || !currentScene?.narration.trim()} onClick={() => void regenerateCurrent()}>{regeneratingSceneId === currentScene?.id ? 'Đang tạo lại…' : 'Tạo lại voice scene này'}</Button></div>}
    {currentScene && !state.isPlaying && !blockedMessage && <div className={styles.pausedAction}><span>Đang tạm dừng ở scene {currentIndex + 1}.</span><Button size="sm" variant="amber" disabled={regeneratingSceneId === currentScene.id || !currentScene.narration.trim()} onClick={() => void regenerateCurrent()}>{regeneratingSceneId === currentScene.id ? 'Đang tạo lại…' : 'Tạo lại voice scene này'}</Button></div>}
    <div className={styles.list} role="list" aria-label="Danh sách voiceover">
      {scenes.map((scene, index) => {
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
          <span className={styles.number}>{String(index + 1).padStart(2, '0')}</span>
          <span className={styles.narration}>{scene.narration || 'Không có lời dẫn'}</span>
          <span className={styles.duration}>{formatDurationSeconds(scene.voiceoverDurationSec ?? scene.durationSec)}s</span>
          <Badge tone={status === 'ready' ? 'green' : status === 'stale' ? 'amber' : 'muted'}>{statusLabels[status]}</Badge>
        </button>;
      })}
    </div>
  </section>;
}
