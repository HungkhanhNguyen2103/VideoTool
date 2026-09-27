import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import {
  ASPECT_RATIOS,
  ASPECT_RESOLUTIONS,
  AI_PROVIDERS,
  VISUAL_STYLE_IDS,
  type CreateProjectRequest,
  type ProjectImportSeed,
  CreateProjectRequestSchema,
} from '../../../../contracts/project';
import { Button } from '../../../shared/ui/Button';
import { Icon } from '../../../shared/ui/Icon';
import { toast } from '../../../shared/ui/toast-store';
import { formatDuration } from '../format';
import { useCreateProject, useUploadVisualStyleSample, useVisualStyleSamples } from '../hooks';
import { useProjectUiStore } from '../store';
import { appendReferenceText, isReferenceFile, mergeProjectPrefill, readReferenceText } from '../reference-import';
import { resolveVisualStylePreview } from '../visual-style-preview';
import styles from './NewProjectForm.module.css';

const DEFAULT_VALUES: CreateProjectRequest = {
  title: '',
  language: 'vi',
  brief: '',
  referencesText: '',
  scriptPresetId: 'documentary',
  visualStylePresetId: 'cinematic',
  targetDurationSec: 180,
  chapterCount: null,
  voiceId: null,
  aiProvider: 'deepseek',
  renderSettings: { aspect: '16:9', width: 1920, height: 1080, fps: 30 },
};

const DURATION_CHIPS = [
  { label: '1 phút', seconds: 60 },
  { label: '3 phút', seconds: 180 },
  { label: '5 phút', seconds: 300 },
  { label: '10 phút', seconds: 600 },
];

const FIELD_ORDER = ['title', 'brief', 'targetDurationSec', 'chapterCount'] as const;

export type NewProjectFormProps = {
  prefill?: ProjectImportSeed | null;
  onPrefillApplied?: () => void;
};

export function NewProjectForm({ prefill, onPrefillApplied }: NewProjectFormProps) {
  const navigate = useNavigate();
  const setCurrentProjectId = useProjectUiStore((s) => s.setCurrentProjectId);
  const createProject = useCreateProject();
  const samplesQuery = useVisualStyleSamples();
  const uploadSample = useUploadVisualStyleSample();
  const sampleInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const [referenceBusy, setReferenceBusy] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setFocus,
    reset,
    getValues,
    formState: { errors, isSubmitted },
  } = useForm<CreateProjectRequest>({
    resolver: zodResolver(CreateProjectRequestSchema),
    defaultValues: DEFAULT_VALUES,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const brief = watch('brief');
  const targetDurationSec = watch('targetDurationSec');
  const visualStylePresetId = watch('visualStylePresetId') ?? 'cinematic';
  const aspect = watch('renderSettings.aspect');
  const width = watch('renderSettings.width');
  const height = watch('renderSettings.height');
  const busy = createProject.isPending;
  const visualStylePreview = resolveVisualStylePreview(visualStylePresetId, samplesQuery.data);

  useEffect(() => {
    if (!prefill) return;
    reset(mergeProjectPrefill(getValues(), prefill));
    onPrefillApplied?.();
  }, [getValues, onPrefillApplied, prefill, reset]);

  async function importReference(file: File) {
    if (!isReferenceFile(file)) {
      toast('Chỉ hỗ trợ file TXT, MD, DOCX hoặc PDF.');
      return;
    }
    try {
      setReferenceBusy(true);
      const text = await readReferenceText(file);
      if (!text.trim()) { toast('File không có nội dung văn bản.'); return; }
      setValue('referencesText', appendReferenceText(watch('referencesText'), text), { shouldDirty: true });
      toast(`Đã thêm nội dung từ ${file.name}.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể đọc file tham khảo.');
    } finally {
      setReferenceBusy(false);
      if (referenceInputRef.current) referenceInputRef.current.value = '';
    }
  }

  async function uploadVisualStyleSample(file: File) {
    try {
      await uploadSample.mutateAsync({ styleId: visualStylePresetId, file });
      await samplesQuery.refetch();
      toast('Đã cập nhật ảnh mẫu phong cách.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thể upload ảnh mẫu.');
    } finally {
      if (sampleInputRef.current) sampleInputRef.current.value = '';
    }
  }

  // Aspect changed: reset resolution to the first option for that aspect if the
  // current width/height pair no longer belongs to it (mirrors the prototype's fillResolutions()).
  useEffect(() => {
    const options = ASPECT_RESOLUTIONS[aspect];
    const stillValid = options.some(([w, h]) => w === width && h === height);
    if (!stillValid) {
      const [w, h] = options[0] ?? ([1920, 1080] as const);
      setValue('renderSettings.width', w);
      setValue('renderSettings.height', h);
    }
  }, [aspect]); // intentionally aspect-only: width/height are set by this effect, including them would loop

  const errorCount = [errors.title, errors.brief, errors.targetDurationSec, errors.chapterCount, errors.renderSettings?.height].filter(
    Boolean,
  ).length;

  async function onSubmit(data: CreateProjectRequest, event?: React.BaseSyntheticEvent) {
    const submitter = (event?.nativeEvent as SubmitEvent | undefined)?.submitter as HTMLButtonElement | undefined;
    const mode = submitter?.value === 'draft' ? 'draft' : 'outline';
    try {
      const project = await createProject.mutateAsync(data);
      setCurrentProjectId(project.id);
      reset(DEFAULT_VALUES);
      onPrefillApplied?.();
      if (mode === 'outline') {
        toast('Đã tạo dự án. Đang chuyển sang "Duyệt & Tái Tạo"…');
        navigate(`/production/${project.id}/review`);
      } else {
        toast('Đã lưu bản nháp.');
      }
    } catch (err) {
      toast(`Không tạo được dự án: ${err instanceof Error ? err.message : 'Lỗi không xác định.'}`);
    }
  }

  function onInvalid() {
    const firstInvalid = FIELD_ORDER.find((key) => errors[key]);
    if (firstInvalid) setFocus(firstInvalid);
    else if (errors.renderSettings?.height) setFocus('renderSettings.height');
  }

  return (
    <section className={styles.panel} aria-labelledby="form-title">
      <h2 className={styles.ptitle} id="form-title">
        <Icon name="sparkles" />
        Tạo dự án mới
      </h2>

      <form className={styles.form} noValidate onSubmit={handleSubmit(onSubmit, onInvalid)}>
        {isSubmitted && errorCount > 0 && (
          <div className={styles.formError} role="alert">
            <Icon name="alert" />
            <span>Vui lòng kiểm tra {errorCount} trường bên dưới.</span>
          </div>
        )}

        <fieldset className={styles.section}>
          <legend className={`label ${styles.legend}`}>Thông tin cơ bản</legend>
          <div className={`${styles.grid} ${styles.grid2to1}`}>
            <div className={styles.field}>
              <label htmlFor="title">
                Tên dự án <span className={styles.req}>*</span>
              </label>
              <input
                className={`${styles.input} ${errors.title ? styles.invalid : ''}`}
                id="title"
                autoComplete="off"
                placeholder="VD: Tên video của bạn"
                aria-invalid={errors.title ? 'true' : 'false'}
                aria-describedby="title-err"
                {...register('title')}
              />
              <p className={styles.fieldError} id="title-err">
                {errors.title?.message}
              </p>
            </div>
            <div className={styles.field}>
              <label htmlFor="language">Ngôn ngữ</label>
              <select className={styles.input} id="language" {...register('language')}>
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className={styles.section}>
          <legend className={`label ${styles.legend}`}>Nội dung</legend>
          <div className={styles.field}>
            <label htmlFor="brief">
              Chủ đề / brief <span className={styles.req}>*</span>
            </label>
            <textarea
              className={`${styles.input} ${styles.textarea} ${errors.brief ? styles.invalid : ''}`}
              id="brief"
              rows={5}
              placeholder="Mô tả chủ đề, góc nhìn, đối tượng người xem…"
              aria-invalid={errors.brief ? 'true' : 'false'}
              aria-describedby="brief-err brief-hint"
              {...register('brief')}
            />
            <div className={styles.fieldRow}>
              <p className={styles.fieldError} id="brief-err">
                {errors.brief?.message}
              </p>
              <p className={`${styles.hint} mono`} id="brief-hint">
                {brief.trim().length} ký tự (tối thiểu 10)
              </p>
            </div>
          </div>

          <div className={styles.field}>
            <label htmlFor="refs-text">
              Tư liệu tham khảo <span className={styles.optional}>(không bắt buộc)</span>
            </label>
            <textarea
              className={`${styles.input} ${styles.textarea}`}
              id="refs-text"
              rows={3}
              placeholder="Dán đoạn văn bản tư liệu vào đây…"
              {...register('referencesText')}
            />
            <div className={styles.uploadRow}>
              <input ref={referenceInputRef} className={styles.hiddenInput} type="file" accept=".txt,.md,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void importReference(file); }} />
              <Button variant="ghost" size="sm" disabled={referenceBusy} busy={referenceBusy} onClick={() => referenceInputRef.current?.click()}>
                <Icon name="upload" />
                Chọn file
              </Button>
              <span className={styles.hint}>TXT/MD đọc ngay; DOCX/PDF sẽ trích xuất văn bản.</span>
            </div>
          </div>
        </fieldset>

        <fieldset className={styles.section}>
          <legend className={`label ${styles.legend}`}>Cấu hình kịch bản</legend>
          <div className={`${styles.grid} ${styles.grid3}`}>
            <div className={styles.field}>
              <label htmlFor="preset">Preset kịch bản</label>
              <select className={styles.input} id="preset" {...register('scriptPresetId')}>
                <option value="documentary">Phim tài liệu (documentary)</option>
                <option value="explainer">Giải thích (explainer)</option>
                <option value="hubris-trap">Kẻ đi săn kiêu ngạo (Hubris Trap)</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="ai-provider">Nhà cung cấp AI</label>
              <select className={styles.input} id="ai-provider" {...register('aiProvider')}>
                {AI_PROVIDERS.map((provider) => <option key={provider} value={provider}>{provider === 'deepseek' ? 'DeepSeek' : 'Claude'}</option>)}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="visual-style">Phong cách hình ảnh</label>
              <div className={styles.stylePicker}>
                <select className={styles.input} id="visual-style" {...register('visualStylePresetId')}>
                  {VISUAL_STYLE_IDS.map((style) => <option key={style} value={style}>{style === 'cinematic' ? 'Cinematic (điện ảnh)' : style === 'anime' ? 'Anime' : style === 'watercolor' ? 'Watercolor (màu nước)' : style === 'photorealistic' ? 'Photorealistic (ảnh thực)' : 'Flat Cartoon'}</option>)}
                </select>
                <div className={styles.styleSampleControls}>
                  <div className={styles.stylePreview} aria-live="polite">
                    {visualStylePreview ? (
                      <>
                        <img className={styles.stylePreviewImage} src={visualStylePreview.src} alt={visualStylePreview.alt} />
                        <a className={styles.stylePreviewDownload} href={visualStylePreview.src} download={visualStylePreview.filename}>
                          Tải ảnh
                        </a>
                      </>
                    ) : (
                      <span className={styles.stylePreviewPlaceholder}>Chưa có ảnh mẫu</span>
                    )}
                  </div>
                  <input ref={sampleInputRef} className={styles.hiddenInput} type="file" accept="image/*" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void uploadVisualStyleSample(file); }} />
                  <Button size="sm" disabled={busy || uploadSample.isPending} busy={uploadSample.isPending} onClick={() => sampleInputRef.current?.click()}>
                    {visualStylePreview ? 'Thay ảnh mẫu' : 'Upload ảnh mẫu'}
                  </Button>
                </div>
              </div>
            </div>
            <div className={styles.field}>
              <label htmlFor="duration">Thời lượng mục tiêu (giây)</label>
              <input
                className={`${styles.input} mono ${errors.targetDurationSec ? styles.invalid : ''}`}
                id="duration"
                type="number"
                min={30}
                max={3600}
                step={1}
                aria-invalid={errors.targetDurationSec ? 'true' : 'false'}
                aria-describedby="duration-err duration-hint"
                {...register('targetDurationSec', { valueAsNumber: true })}
              />
              <p className={styles.hint} id="duration-hint">
                {Number.isInteger(targetDurationSec) && targetDurationSec > 0 ? `≈ ${formatDuration(targetDurationSec)}` : ''}
              </p>
              <p className={styles.fieldError} id="duration-err">
                {errors.targetDurationSec?.message}
              </p>
            </div>
            <div className={styles.field}>
              <label htmlFor="chapters">
                Số chương dự kiến <span className={styles.optional}>(tùy chọn)</span>
              </label>
              <input
                className={`${styles.input} mono ${errors.chapterCount ? styles.invalid : ''}`}
                id="chapters"
                type="number"
                min={1}
                max={20}
                step={1}
                placeholder="AI tự quyết"
                aria-invalid={errors.chapterCount ? 'true' : 'false'}
                aria-describedby="chapters-err"
                {...register('chapterCount', { setValueAs: (v) => (v === '' || v === null ? null : Number(v)) })}
              />
              <p className={styles.fieldError} id="chapters-err">
                {errors.chapterCount?.message}
              </p>
            </div>
          </div>
          <div className={styles.quick} role="group" aria-label="Chọn nhanh thời lượng">
            {DURATION_CHIPS.map((chip) => (
              <button
                key={chip.seconds}
                type="button"
                className={styles.chipBtn}
                onClick={() => setValue('targetDurationSec', chip.seconds, { shouldValidate: isSubmitted })}
              >
                {chip.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className={styles.section}>
          <legend className={`label ${styles.legend}`}>Cấu hình video</legend>
          <div className={`${styles.grid} ${styles.grid4}`}>
            <div className={styles.field}>
              <span id="aspect-label">Khổ hình</span>
              <div className={styles.segmented} role="radiogroup" aria-labelledby="aspect-label">
                {ASPECT_RATIOS.map((value) => (
                  <label key={value} className={styles.segmentedOption}>
                    <input type="radio" value={value} {...register('renderSettings.aspect')} />
                    <span className={styles.segmentedLabel}>{value}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className={styles.field}>
              <label htmlFor="resolution">Độ phân giải</label>
              <select
                className={`${styles.input} mono`}
                id="resolution"
                value={`${width}x${height}`}
                onChange={(e) => {
                  const [w, h] = e.target.value.split('x').map(Number);
                  if (w === undefined || h === undefined) return;
                  setValue('renderSettings.width', w, { shouldValidate: isSubmitted });
                  setValue('renderSettings.height', h, { shouldValidate: isSubmitted });
                }}
              >
                {ASPECT_RESOLUTIONS[aspect].map(([w, h]) => (
                  <option key={`${w}x${h}`} value={`${w}x${h}`}>
                    {w}×{h}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="fps">FPS</label>
              <select className={`${styles.input} mono`} id="fps" {...register('renderSettings.fps', { valueAsNumber: true })}>
                <option value={24}>24</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </div>
            <div className={styles.field}>
              <label htmlFor="voice">Giọng đọc mặc định</label>
              <select
                className={styles.input}
                id="voice"
                {...register('voiceId', { setValueAs: (v) => (v === '' ? null : v) })}
              >
                <option value="">Chưa chọn (chọn sau ở Studio)</option>
                <option value="voice-1">[Giọng đọc 1]</option>
                <option value="voice-2">[Giọng đọc 2]</option>
              </select>
            </div>
          </div>
        </fieldset>

        <div className={styles.formActions}>
          <span className={styles.hint}>Có thể đổi các cấu hình này sau.</span>
          <span className="spacer" />
          <Button type="submit" value="draft" size="lg" disabled={busy}>
            {busy ? 'Đang lưu…' : 'Chỉ lưu nháp'}
          </Button>
          <Button type="submit" value="outline" variant="amber" size="lg" disabled={busy} busy={busy}>
            {busy ? 'Đang tạo…' : 'Tạo dàn ý'}
            <Icon name="arrow-right" />
          </Button>
        </div>
      </form>
    </section>
  );
}
