import { useEffect, useMemo, useState } from 'react';
import { AI_MODEL_REGISTRY } from '../../../../contracts/ai-models';
import { hashNarration } from '../../../../contracts/name-keywords';
import { POPUP_DENSITIES, type PopupBackend, type PopupDensity, type PopupPlanPopup } from '../../../../contracts/popup-analysis';
import type { ProjectDetail, Scene } from '../../../../contracts/project';
import { activeScenes } from '../../../../contracts/scene-active';
import { AiModelSelect } from '../../../shared/ai/AiModelSelect';
import { Button } from '../../../shared/ui/Button';
import styles from './PopupAnalysisCard.module.css';
import { formatBatchSceneCount } from '../scene-activity-ui';

export type PopupAnalysisSummary = { scenesApplied: number; scenesExpected: number; rejectedCandidates: number };

export type PopupAnalysisCardProps = {
  project: ProjectDetail;
  scenes: Scene[];
  disabled?: boolean;
  analysisActive?: boolean;
  cliAvailable?: boolean;
  cliStatusText?: string;
  summary?: PopupAnalysisSummary | null;
  onApiModelChange: (model: string) => Promise<void>;
  onAnalyze: (input: { backend: PopupBackend; density: PopupDensity; cliModel?: string }) => Promise<void>;
  onDensityChange: (density: PopupDensity) => Promise<void>;
  onToggleFlags: (sceneId: string, anchor: string, flags: { pinned?: boolean; suppressed?: boolean }) => Promise<void>;
  onEdit: (sceneId: string, popup: PopupPlanPopup) => Promise<void>;
};

function freshPlan(scene: Scene): NonNullable<Scene['popupPlan']> | null {
  return scene.popupPlan && scene.audioFileId && scene.wordTimings?.audioFileId === scene.audioFileId && scene.popupPlan.audioFileId === scene.audioFileId && scene.popupPlan.narrationHash === hashNarration(scene.narration)
    ? scene.popupPlan
    : null;
}

function planState(scene: Scene): string {
  if (!scene.popupPlan) return 'Chưa phân tích';
  if (!freshPlan(scene)) return 'Cần phân tích lại';
  return scene.popupPlan.needed ? 'Cần popup' : 'Không cần popup';
}

function popupRows(scene: Scene): PopupPlanPopup[] {
  const plan = freshPlan(scene);
  return plan ? [...plan.popups, ...plan.dropped] : [];
}

export function PopupAnalysisCard({
  project,
  scenes,
  disabled = false,
  analysisActive = false,
  cliAvailable = false,
  cliStatusText,
  summary,
  onApiModelChange,
  onAnalyze,
  onDensityChange,
  onToggleFlags,
  onEdit,
}: PopupAnalysisCardProps) {
  const [backend, setBackend] = useState<PopupBackend>('api');
  const [density, setDensity] = useState<PopupDensity>(project.popupDensity);
  const [cliModel, setCliModel] = useState<string>(AI_MODEL_REGISTRY.claude.defaultModelId);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingDisplay, setEditingDisplay] = useState('');
  const activeSceneEntries = useMemo(() => activeScenes(scenes.map((scene, index) => ({ scene, index, active: scene.active }))), [scenes]);
  const activeSceneList = useMemo(() => activeSceneEntries.map(({ scene }) => scene), [activeSceneEntries]);
  const freshCount = activeSceneList.filter((scene) => freshPlan(scene)).length;
  const staleCount = activeSceneList.filter((scene) => scene.popupPlan && !freshPlan(scene)).length;
  const eligible = (scene: Scene) => Boolean(scene.audioFileId && scene.wordTimings?.audioFileId === scene.audioFileId && scene.wordTimings.words.length > 0);
  const eligibleCount = activeSceneList.filter(eligible).length;
  const cliBlocked = backend === 'cli' && !cliAvailable;
  const latestPlan = activeSceneList.map((scene) => scene.popupPlan).filter((plan): plan is NonNullable<Scene['popupPlan']> => Boolean(plan)).sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))[0];

  useEffect(() => { setDensity(project.popupDensity); }, [project.popupDensity]);

  async function changeDensity(value: PopupDensity): Promise<void> {
    setDensity(value);
    await onDensityChange(value);
  }

  async function analyze(): Promise<void> {
    await onAnalyze({ backend, density, ...(backend === 'cli' ? { cliModel } : {}) });
  }

  async function saveEdit(sceneId: string, popup: PopupPlanPopup): Promise<void> {
    const next = { ...popup, display: editingDisplay.trim() };
    if (!next.display) return;
    await onEdit(sceneId, next);
    setEditingKey(null);
  }

  return <section className={styles.card} aria-labelledby="popup-analysis-title">
    <div className={styles.header}>
      <div>
        <h3 id="popup-analysis-title">Phân tích popup chữ</h3>
        <p className={styles.muted}>Phân tích từ popupPlan đã lưu; không đọc dữ liệu nameCandidates cũ.</p>
      </div>
      <span className={styles.counter}>{freshCount}/{eligibleCount} scene đã có kết quả</span>
    </div>

    <div className={styles.controls}>
      <label>Backend popup
        <select aria-label="Backend popup" value={backend} disabled={disabled || analysisActive} onChange={(event) => setBackend(event.currentTarget.value as PopupBackend)}>
          <option value="api">API ({project.aiProvider})</option>
          <option value="cli">Claude CLI</option>
        </select>
      </label>
      <label>Mật độ popup
        <select aria-label="Mật độ popup" value={density} disabled={disabled || analysisActive} onChange={(event) => void changeDensity(event.currentTarget.value as PopupDensity)}>
          {POPUP_DENSITIES.map((value) => <option key={value} value={value}>{value === 'low' ? 'Ít — chỉ điểm nhấn' : value === 'medium' ? 'Vừa — cân bằng' : 'Nhiều — nhiều thông tin hơn'}</option>)}
        </select>
      </label>
      {backend === 'cli' ? <label>Model Claude CLI
        <select aria-label="Model AI" value={cliModel} disabled={disabled || analysisActive || cliBlocked} onChange={(event) => setCliModel(event.currentTarget.value)}>
          {AI_MODEL_REGISTRY.claude.models.map((model) => <option key={model.id} value={model.id}>{model.label} — {model.hint}</option>)}
        </select>
      </label> : <AiModelSelect provider={project.aiProvider} value={project.aiModel} disabled={disabled || analysisActive} showCostNote={false} onChange={(model) => void onApiModelChange(model)} />}
      <Button size="sm" variant="indigoline" disabled={disabled || analysisActive || cliBlocked || eligibleCount === 0} onClick={() => void analyze()}>Phân tích popup · {formatBatchSceneCount(scenes, eligible)}</Button>
    </div>
    {backend === 'cli' && <p className={cliBlocked ? styles.warning : styles.muted} role="status">{cliBlocked ? (cliStatusText ?? 'Claude Code CLI chưa khả dụng trên máy chủ này.') : 'Claude Code CLI sẵn sàng.'}</p>}
    <p className={styles.muted} role="status">{latestPlan ? `Lần chạy gần nhất: ${latestPlan.backend} · ${latestPlan.provider}/${latestPlan.model} · ${new Date(latestPlan.generatedAt).toLocaleString('vi-VN')}.` : 'Chưa có lần phân tích popup nào.'}</p>
    {staleCount > 0 && <p className={styles.warning} role="status">{staleCount} scene có kết quả cũ sau khi narration hoặc voiceover thay đổi; hãy phân tích lại để cập nhật.</p>}
    {freshCount < eligibleCount && <p className={styles.warning} role="status">Scene chưa được phân tích sẽ không hiển thị popup cho đến khi chạy phân tích.</p>}
    {summary && <p className={styles.summary} role="status">Đã áp dụng {summary.scenesApplied}/{summary.scenesExpected} scene · từ chối {summary.rejectedCandidates} ứng viên.</p>}

    <div className={styles.sceneList}>
      {activeSceneEntries.map(({ scene, index }) => {
        const plan = scene.popupPlan;
        const rows = popupRows(scene);
        return <article className={styles.scene} key={scene.id}>
          <div className={styles.sceneHeader}><strong>Scene {String(index + 1).padStart(2, '0')}</strong><span className={styles.state}>{planState(scene)}</span></div>
          {plan && <p className={styles.reason}>{plan.reason}</p>}
          {rows.length === 0 ? <p className={styles.muted}>Chưa có popup được đề xuất.</p> : <ul className={styles.popupList}>
            {rows.map((popup) => {
              const key = `${scene.id}:${popup.anchor}`;
              const editing = editingKey === key;
              return <li className={`${styles.popup} ${popup.status === 'dropped' ? styles.dropped : ''}`} key={key}>
                <div className={styles.popupBody}>
                  {editing ? <input aria-label="Sửa display popup" value={editingDisplay} onChange={(event) => setEditingDisplay(event.currentTarget.value)} /> : <strong>{popup.display}</strong>}
                  <span>{popup.kind} · mức {popup.importance}/5 · {popup.reason}</span>
                  {popup.dropReason && <em>Đã bỏ: {popup.dropReason}</em>}
                </div>
                <div className={styles.actions}>
                  {editing ? <><Button size="sm" variant="green" disabled={disabled} onClick={() => void saveEdit(scene.id, popup)}>Lưu</Button><Button size="sm" disabled={disabled} onClick={() => setEditingKey(null)}>Huỷ</Button></> : <>
                    <Button size="sm" active={popup.pinned} disabled={disabled} onClick={() => void onToggleFlags(scene.id, popup.anchor, { pinned: !popup.pinned })}>{popup.pinned ? 'Bỏ ghim' : 'Ghim'}</Button>
                    <Button size="sm" active={popup.suppressed} disabled={disabled} onClick={() => void onToggleFlags(scene.id, popup.anchor, { suppressed: !popup.suppressed })}>{popup.suppressed ? 'Bật lại' : 'Tắt'}</Button>
                    <Button size="sm" disabled={disabled} onClick={() => { setEditingKey(key); setEditingDisplay(popup.display); }}>Sửa</Button>
                  </>}
                </div>
              </li>;
            })}
          </ul>}
        </article>;
      })}
      {scenes.length === 0 && <p className={styles.muted}>Chưa có scene để phân tích.</p>}
      {scenes.length > 0 && activeSceneEntries.length === 0 && <p className={styles.muted}>Không có scene nào đang bật để phân tích.</p>}
    </div>
  </section>;
}
