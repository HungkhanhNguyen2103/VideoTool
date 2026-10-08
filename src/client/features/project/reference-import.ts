import { ApiError } from '../../shared/api-client';
import { ApiErrorBodySchema } from '../../../contracts/common';
import { ASPECT_RESOLUTIONS, ProjectImportSeedSchema, type CreateProjectRequest, type ProjectImportSeed } from '../../../contracts/project';
import { getDefaultAiModelId, isAiModelForProvider } from '../../../contracts/ai-models';
import { z } from 'zod';

const ReferenceTextResponseSchema = z.object({ text: z.string() });
const PLAIN_REFERENCE_EXTENSIONS = new Set(['txt', 'md']);
const REFERENCE_EXTENSIONS = new Set(['txt', 'md', 'docx', 'pdf']);

function extension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function appendReferenceText(current: string, imported: string): string {
  return [current.trim(), imported.trim()].filter(Boolean).join('\n\n');
}

export function mergeProjectPrefill(current: CreateProjectRequest, prefill: ProjectImportSeed): CreateProjectRequest {
  const aiProvider = prefill.aiProvider ?? current.aiProvider ?? 'deepseek';
  const aiModel = prefill.aiModel !== undefined
    ? isAiModelForProvider(aiProvider, prefill.aiModel) ? prefill.aiModel : getDefaultAiModelId(aiProvider)
    : prefill.aiProvider !== undefined && prefill.aiProvider !== current.aiProvider
      ? getDefaultAiModelId(aiProvider)
      : isAiModelForProvider(aiProvider, current.aiModel) ? current.aiModel : getDefaultAiModelId(aiProvider);
  const aspect = prefill.renderSettings?.aspect ?? current.renderSettings.aspect;
  const currentResolution = ASPECT_RESOLUTIONS[aspect].find(([w, h]) => w === current.renderSettings.width && h === current.renderSettings.height);
  const [width, height] = currentResolution ?? ASPECT_RESOLUTIONS[aspect][0] ?? [1920, 1080];
  return {
    ...current,
    ...prefill,
    aiProvider,
    aiModel,
    referencesText: appendReferenceText(current.referencesText, prefill.referencesText ?? ''),
    renderSettings: { ...current.renderSettings, ...prefill.renderSettings, aspect, width, height },
  };
}

export function isReferenceFile(file: Pick<File, 'name' | 'type'>): boolean {
  return REFERENCE_EXTENSIONS.has(extension(file.name)) || file.type === 'application/pdf' || file.type.includes('wordprocessingml.document');
}

export async function readReferenceText(file: File): Promise<string> {
  const ext = extension(file.name);
  if (PLAIN_REFERENCE_EXTENSIONS.has(ext) || file.type === 'text/plain' || file.type === 'text/markdown') return file.text();
  if (!isReferenceFile(file)) throw new Error('Chỉ hỗ trợ TXT, MD, DOCX hoặc PDF.');
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/project/reference-text', { method: 'POST', body: form });
  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = null; }
    const parsed = ApiErrorBodySchema.safeParse(payload);
    if (parsed.success) throw new ApiError(parsed.data.error.message, response.status, parsed.data.error.code, parsed.data.error.fields);
    throw new ApiError(`Không thể đọc file (${response.status}).`, response.status, 'REFERENCE_TEXT_FAILED');
  }
  return ReferenceTextResponseSchema.parse(await response.json()).text;
}

export async function importProjectSeed(file: File) {
  if (extension(file.name) !== 'zip' && file.type !== 'application/zip' && file.type !== 'application/x-zip-compressed') {
    throw new Error('Chỉ hỗ trợ file ZIP.');
  }
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/api/project/import-seed', { method: 'POST', body: form });
  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.json(); } catch { payload = null; }
    const parsed = ApiErrorBodySchema.safeParse(payload);
    if (parsed.success) throw new ApiError(parsed.data.error.message, response.status, parsed.data.error.code, parsed.data.error.fields);
    throw new ApiError(`Không thể nhập ZIP (${response.status}).`, response.status, 'PROJECT_IMPORT_FAILED');
  }
  return ProjectImportSeedSchema.parse(await response.json());
}
