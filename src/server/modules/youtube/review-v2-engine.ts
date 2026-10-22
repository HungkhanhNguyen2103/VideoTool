import { YoutubeChannelReviewV2AnalysisSchema, YoutubeReviewIdeasAnalysisSchema, YoutubeVideoReviewV2AnalysisSchema, type YoutubeChannelReviewV2Analysis, type YoutubeReviewGroundingReport, type YoutubeReviewIdea, type YoutubeVideoReviewV2Analysis } from '../../../contracts/youtube-review';
import { AppError } from '../../shared/errors';
import type { ChatMessage } from '../../shared/ai';
import { parseJsonWithLeadingText } from '../../shared/claude-cli/json-output';
import type { ReviewMetricMap } from './review-evidence';
import { validateYoutubeReviewGrounding, type YoutubeReviewInvalidItem } from './review-grounding';
import { buildYoutubeReviewV2Messages, YOUTUBE_REVIEW_PROMPT_VERSIONS, type YoutubeReviewPromptKind } from './review-prompts';

export type YoutubeReviewV2Backend = {
  kind: 'cli' | 'api';
  model: string;
  chat: (messages: ChatMessage[], options?: { stepLabel?: string }) => Promise<string>;
};

export type YoutubeReviewJobContext = {
  reportProgress: (percent: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
};

export type YoutubeReviewEvidencePacket = {
  packet: Record<string, unknown>;
  metricMap: ReviewMetricMap;
  fingerprint: string;
  serialized: string;
  packetSummary: { matureCount: number; includedVideoCount: number; truncatedVideoCount: number };
};

export const YOUTUBE_REVIEW_HEARTBEAT_INTERVAL_MS = 30_000;
export const YOUTUBE_REVIEW_MAX_HEARTBEATS_PER_STEP = 20;
export const YOUTUBE_REVIEW_IDEAS_MIN_MATURE = 10;

type JsonRecord = Record<string, unknown>;

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function schemaFor(kind: YoutubeReviewPromptKind) {
  if (kind === 'channel') return YoutubeChannelReviewV2AnalysisSchema;
  if (kind === 'video') return YoutubeVideoReviewV2AnalysisSchema;
  return YoutubeReviewIdeasAnalysisSchema;
}

function object(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

async function requestChat(input: {
  kind: YoutubeReviewPromptKind;
  packet: YoutubeReviewEvidencePacket;
  backend: YoutubeReviewV2Backend;
  context: YoutubeReviewJobContext;
  label: string;
  step: { index: number; total: number; name: string };
  repair?: { invalidItems: YoutubeReviewInvalidItem[]; originalOutput: unknown };
}): Promise<string | undefined> {
  if (await input.context.isCancelled()) return undefined;
  const messages = buildYoutubeReviewV2Messages({ kind: input.kind, packetJson: input.packet.serialized, ...(input.repair ? { repair: input.repair } : {}) });
  const promptBytes = messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0);
  const prefix = `Bước ${input.step.index}/${input.step.total} — ${input.step.name}`;
  const startedAt = Date.now();
  await input.context.appendLog(`${prefix}: gửi yêu cầu (${promptBytes} byte).`);
  let heartbeatCount = 0;
  let heartbeatTask: Promise<void> | null = null;
  let heartbeatError: unknown;
  const timer = setInterval(() => {
    if (heartbeatTask || heartbeatCount >= YOUTUBE_REVIEW_MAX_HEARTBEATS_PER_STEP) {
      if (heartbeatCount >= YOUTUBE_REVIEW_MAX_HEARTBEATS_PER_STEP) clearInterval(timer);
      return;
    }
    heartbeatTask = (async () => {
      if (await input.context.isCancelled()) return;
      heartbeatCount += 1;
      await input.context.appendLog(`${prefix}: vẫn đang chờ (${formatElapsed(Date.now() - startedAt)})…`);
      if (heartbeatCount >= YOUTUBE_REVIEW_MAX_HEARTBEATS_PER_STEP) clearInterval(timer);
    })().catch((error: unknown) => { heartbeatError = error; clearInterval(timer); }).finally(() => { heartbeatTask = null; });
  }, YOUTUBE_REVIEW_HEARTBEAT_INTERVAL_MS);
  let raw = '';
  try {
    raw = await input.backend.chat(messages, { stepLabel: `${input.label}${input.repair ? '-grounding-repair' : ''}` });
  } finally {
    clearInterval(timer);
    if (heartbeatTask) await heartbeatTask;
  }
  if (heartbeatError) throw heartbeatError;
  if (await input.context.isCancelled()) return undefined;
  await input.context.appendLog(`${prefix}: nhận phản hồi sau ${formatElapsed(Date.now() - startedAt)} (${Buffer.byteLength(raw, 'utf8')} byte).`);
  return raw;
}

async function requestValidated(input: {
  kind: YoutubeReviewPromptKind;
  packet: YoutubeReviewEvidencePacket;
  backend: YoutubeReviewV2Backend;
  context: YoutubeReviewJobContext;
  label: string;
  step: { index: number; total: number; name: string };
  repair?: { invalidItems: YoutubeReviewInvalidItem[]; originalOutput: unknown };
}): Promise<unknown | undefined> {
  let validationError = '';
  const schema = schemaFor(input.kind);
  const attemptLimit = input.repair ? 1 : 2;
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const wrappedBackend = attempt === 0 ? input.backend : {
      ...input.backend,
      chat: (baseMessages: ChatMessage[], options?: { stepLabel?: string }) => input.backend.chat(
        [{ ...baseMessages[0]! }, { ...baseMessages[1]!, content: `${baseMessages[1]!.content}\n\nValidation error: ${validationError}\nReturn corrected JSON for exactly the requested schema.` }], options),
    };
    const raw = await requestChat({ ...input, backend: wrappedBackend });
    if (raw === undefined) return undefined;
    let parsed: unknown;
    try {
      let leadingTextBytes = 0;
      parsed = parseJsonWithLeadingText(raw, (leadingText) => { leadingTextBytes = Buffer.byteLength(leadingText, 'utf8'); });
      if (leadingTextBytes > 0 && input.backend.kind === 'cli') await input.context.appendLog(`Claude CLI ${input.label}: bỏ qua ${leadingTextBytes} byte chữ trước JSON.`);
    } catch {
      validationError = 'root: invalid JSON';
      if (attempt === attemptLimit - 1) throw new AppError(`Claude không trả JSON hợp lệ ở bước ${input.step.name}.`, 422, input.repair ? 'YOUTUBE_REVIEW_UNGROUNDED' : 'YOUTUBE_REVIEW_PARSE_ERROR');
      await input.context.appendLog(`${input.step.name}: JSON chưa hợp lệ, thử lại đúng một lần.`);
      continue;
    }
    const result = schema.safeParse(parsed);
    if (result.success) return result.data;
    validationError = result.error.issues.map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`).slice(0, 20).join('; ');
    if (attempt === attemptLimit - 1) throw new AppError(`Đầu ra đánh giá YouTube không khớp schema ở bước ${input.step.name}.`, 422, input.repair ? 'YOUTUBE_REVIEW_UNGROUNDED' : 'YOUTUBE_REVIEW_PARSE_ERROR');
    await input.context.appendLog(`${input.step.name}: schema chưa hợp lệ, thử lại đúng một lần.`);
  }
  return undefined;
}

function pathParts(path: string): (string | number)[] {
  return [...path.matchAll(/([^[.\]]+)|\[(\d+)\]/gu)].map((match) => match[2] ? Number(match[2]) : match[1]!);
}

function getChild(value: unknown, key: string | number): unknown {
  if (Array.isArray(value)) return typeof key === 'number' ? value[key] : undefined;
  if (value && typeof value === 'object') return (value as JsonRecord)[String(key)];
  return undefined;
}

function mergePath(target: JsonRecord, source: unknown, path: string): void {
  const parts = pathParts(path);
  if (!parts.length) return;
  let targetParent: unknown = target; let sourceParent: unknown = source;
  for (const part of parts.slice(0, -1)) {
    targetParent = getChild(targetParent, part); sourceParent = getChild(sourceParent, part);
  }
  const last = parts[parts.length - 1]!;
  if (Array.isArray(targetParent) && typeof last === 'number') {
    targetParent[last] = Array.isArray(sourceParent) && last < sourceParent.length ? structuredClone(sourceParent[last]) : undefined;
    return;
  }
  if (!targetParent || typeof targetParent !== 'object' || Array.isArray(targetParent)) return;
  const targetRecord = targetParent as JsonRecord;
  const sourceRecord = object(sourceParent);
  if (Object.hasOwn(sourceRecord, last)) targetRecord[String(last)] = structuredClone(sourceRecord[String(last)]);
  else delete targetRecord[String(last)];
}

function arrayPath(path: string): string | null {
  const match = path.match(/^([A-Za-z][\w]*)\[\d+\]$/u);
  return match?.[1] ?? null;
}

function removeInvalidRows(output: JsonRecord, invalidItems: readonly YoutubeReviewInvalidItem[]): void {
  const indexes = new Map<string, Set<number>>();
  for (const item of invalidItems) {
    const match = item.path.match(/^([A-Za-z][\w]*)\[(\d+)\]$/u);
    if (!match) continue;
    const set = indexes.get(match[1]!) ?? new Set<number>();
    set.add(Number(match[2])); indexes.set(match[1]!, set);
  }
  for (const [field, dropping] of indexes) {
    if (!Array.isArray(output[field])) continue;
    output[field] = output[field].filter((_value: unknown, index: number) => !dropping.has(index));
  }
  if (invalidItems.some((item) => item.path === 'diagnosis')) {
    const diagnosis = object(output.diagnosis);
    const metricIds = Array.isArray(diagnosis.metricIds) ? diagnosis.metricIds.filter((id: unknown) => typeof id === 'string') : [];
    output.diagnosis = { classification: 'unclear', reasoning: 'Chưa đủ căn cứ để phân biệt mức độ phù hợp của ngách với cách thực hiện.', metricIds };
  }
}

function shouldFailForDropped(output: JsonRecord, invalidItems: readonly YoutubeReviewInvalidItem[]): boolean {
  if (invalidItems.some((item) => item.path === 'summary' || item.path === 'nextChange')) return true;
  const totals = new Map<string, number>();
  for (const [field, value] of Object.entries(output)) if (Array.isArray(value)) totals.set(field, value.length);
  const dropped = new Map<string, number>();
  for (const item of invalidItems) {
    const field = arrayPath(item.path);
    if (field) dropped.set(field, (dropped.get(field) ?? 0) + 1);
  }
  for (const [field, count] of dropped) if (count > (totals.get(field) ?? 0) / 2) return true;
  return false;
}

function ground(input: {
  target: 'channel' | 'video' | 'ideas'; output: unknown; packet: YoutubeReviewEvidencePacket; matureCount: number;
}) {
  return validateYoutubeReviewGrounding({ target: input.target, output: input.output, packet: input.packet.packet, metricMap: input.packet.metricMap, matureCount: input.matureCount });
}

export async function runYoutubeReviewV2Analysis(input: {
  target: 'channel' | 'video';
  packet: YoutubeReviewEvidencePacket;
  backend: YoutubeReviewV2Backend;
  context: YoutubeReviewJobContext;
}): Promise<{ analysis: YoutubeChannelReviewV2Analysis | YoutubeVideoReviewV2Analysis; ideas?: { status: 'generated' | 'gated'; reason?: string; items: YoutubeReviewIdea[] }; groundingReport: YoutubeReviewGroundingReport; promptVersion: string } | undefined> {
  const channel = input.target === 'channel';
  const hasIdeasStep = channel && input.packet.packetSummary.matureCount >= YOUTUBE_REVIEW_IDEAS_MIN_MATURE;
  const totalSteps = channel ? 2 : 1;
  const analysisStep = { index: 1, total: totalSteps, name: channel ? 'Đánh giá kênh' : 'Đánh giá video' };
  if (input.packet.packetSummary.truncatedVideoCount) {
    await input.context.appendLog(`Gói chứng cứ vượt ${input.packet.serialized.length} ký tự; bỏ ${input.packet.packetSummary.truncatedVideoCount} video cũ để giữ giới hạn.`);
  }
  await input.context.reportProgress(5, { step: analysisStep.name });
  let analysis = await requestValidated({ kind: input.target, packet: input.packet, backend: input.backend, context: input.context, label: `youtube-review-${input.target}`, step: analysisStep });
  if (analysis === undefined || await input.context.isCancelled()) return undefined;
  let validation = ground({ target: input.target, output: analysis, packet: input.packet, matureCount: input.packet.packetSummary.matureCount });
  let repaired = 0;
  if (validation.invalidItems.length) {
    const initialInvalidPaths = validation.invalidItems.map((item) => item.path);
    await input.context.appendLog(`${analysisStep.name}: ${validation.invalidItems.length} mục cần đối chiếu lại; gửi một yêu cầu sửa.`);
    const repairedOutput = await requestValidated({
      kind: input.target, packet: input.packet, backend: input.backend, context: input.context,
      label: `youtube-review-${input.target}-repair`, step: analysisStep,
      repair: { invalidItems: validation.invalidItems, originalOutput: validation.output },
    });
    if (repairedOutput === undefined || await input.context.isCancelled()) return undefined;
    const merged = structuredClone(validation.output);
    for (const item of validation.invalidItems) mergePath(merged, repairedOutput, item.path);
    analysis = merged;
    validation = ground({ target: input.target, output: analysis, packet: input.packet, matureCount: input.packet.packetSummary.matureCount });
    const remainingPaths = new Set(validation.invalidItems.map((item) => item.path));
    repaired = initialInvalidPaths.filter((path) => !remainingPaths.has(path)).length;
  }
  if (shouldFailForDropped(validation.output, validation.invalidItems)) {
    throw new AppError('Claude trả về quá nhiều nhận định không có đủ căn cứ. Hãy đồng bộ thêm dữ liệu rồi thử lại.', 422, 'YOUTUBE_REVIEW_UNGROUNDED');
  }
  removeInvalidRows(validation.output, validation.invalidItems);
  const dropped = validation.invalidItems.map((item) => ({ path: item.path, reasons: item.reasons }));
  let ideas: { status: 'generated' | 'gated'; reason?: string; items: YoutubeReviewIdea[] } | undefined = channel
    ? hasIdeasStep ? undefined : { status: 'gated', reason: `Cần ít nhất ${YOUTUBE_REVIEW_IDEAS_MIN_MATURE} video đã đủ 28 ngày; hiện có ${input.packet.packetSummary.matureCount}.`, items: [] }
    : undefined;
  let ideaReport: YoutubeReviewGroundingReport | undefined;
  if (!channel) {
    if (dropped.length) await input.context.appendLog(`Đã bỏ ${dropped.length} mục không qua đối chiếu grounding.`);
    await input.context.reportProgress(95, { step: analysisStep.name });
    return { analysis: YoutubeVideoReviewV2AnalysisSchema.parse(validation.output), groundingReport: { checked: validation.checked, repaired, dropped }, promptVersion: YOUTUBE_REVIEW_PROMPT_VERSIONS.video };
  }

  await input.context.reportProgress(55, { step: analysisStep.name });
  if (!hasIdeasStep) {
    await input.context.appendLog(`Bỏ qua ý tưởng video: ${ideas!.reason}`);
  } else {
    const step = { index: 2, total: 2, name: 'Ý tưởng video tiếp theo' };
    await input.context.reportProgress(60, { step: step.name });
    const ideaOutput = await requestValidated({ kind: 'ideas', packet: input.packet, backend: input.backend, context: input.context, label: 'youtube-review-ideas', step });
    if (ideaOutput === undefined || await input.context.isCancelled()) return undefined;
    let ideaValidation = ground({ target: 'ideas', output: ideaOutput, packet: input.packet, matureCount: input.packet.packetSummary.matureCount });
    let ideasResult = ideaValidation.output;
    let ideasRepaired = 0;
    if (ideaValidation.invalidItems.length) {
      const initialInvalidPaths = ideaValidation.invalidItems.map((item) => item.path);
      await input.context.appendLog(`${step.name}: ${ideaValidation.invalidItems.length} ý tưởng cần đối chiếu lại; gửi một yêu cầu sửa.`);
      const repairOutput = await requestValidated({ kind: 'ideas', packet: input.packet, backend: input.backend, context: input.context, label: 'youtube-review-ideas-repair', step, repair: { invalidItems: ideaValidation.invalidItems, originalOutput: ideaValidation.output } });
      if (repairOutput === undefined || await input.context.isCancelled()) return undefined;
      const merged = structuredClone(ideaValidation.output);
      for (const item of ideaValidation.invalidItems) mergePath(merged, repairOutput, item.path);
      ideasResult = merged;
      ideaValidation = ground({ target: 'ideas', output: ideasResult, packet: input.packet, matureCount: input.packet.packetSummary.matureCount });
      ideasResult = ideaValidation.output;
      const remainingPaths = new Set(ideaValidation.invalidItems.map((item) => item.path));
      ideasRepaired = initialInvalidPaths.filter((path) => !remainingPaths.has(path)).length;
    }
    if (shouldFailForDropped(ideaValidation.output, ideaValidation.invalidItems)) {
      throw new AppError('Claude trả về quá nhiều ý tưởng không có đủ căn cứ. Hãy thử lại sau khi kiểm tra dữ liệu.', 422, 'YOUTUBE_REVIEW_UNGROUNDED');
    }
    removeInvalidRows(ideasResult, ideaValidation.invalidItems);
    ideasResult = ideaValidation.output;
    ideas = { status: 'generated', items: YoutubeReviewIdeasAnalysisSchema.parse(ideasResult).ideas };
    ideaReport = { checked: ideaValidation.checked, repaired: ideasRepaired, dropped: ideaValidation.invalidItems.map((item) => ({ path: item.path, reasons: item.reasons })) };
    dropped.push(...ideaReport.dropped);
  }
  if (await input.context.isCancelled()) return undefined;
  if (dropped.length) await input.context.appendLog(`Đã bỏ ${dropped.length} mục không qua đối chiếu grounding.`);
  await input.context.reportProgress(95, { step: 'Hoàn tất đánh giá' });
  return {
    analysis: YoutubeChannelReviewV2AnalysisSchema.parse(validation.output),
    ...(ideas ? { ideas } : {}),
    groundingReport: { checked: validation.checked + (ideaReport?.checked ?? 0), repaired: repaired + (ideaReport?.repaired ?? 0), dropped },
    promptVersion: YOUTUBE_REVIEW_PROMPT_VERSIONS.channel,
  };
}
