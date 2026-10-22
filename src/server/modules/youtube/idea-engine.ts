import { z } from 'zod';
import { YoutubeIdeaDraftSchema, YoutubeIdeaScoresSchema, YoutubeIdeaSchema, type YoutubeIdea, type YoutubeIdeaDraft, type YoutubeIdeaDropped } from '../../../contracts/youtube-ideas';
import { findDuplicateTitle } from '../../../contracts/seo-duplicates';
import type { ChatMessage } from '../../shared/ai';
import { AppError } from '../../shared/errors';
import { parseJsonWithLeadingText } from '../../shared/claude-cli/json-output';
import { buildYoutubeIdeaMessages, YOUTUBE_IDEA_PROMPT_VERSIONS } from './idea-prompts';
import type { YoutubeIdeaPacket } from './idea-packet';

export const YOUTUBE_IDEA_FORBIDDEN_PROMISES = [
  'se dat', 'se tang', 'se co', 'chac chan viral', 'dam bao', 'bao dam', 'cam ket',
  'luot xem se', 'views will', 'view will', 'revenue will', 'doanh thu se', 'thu nhap se',
  'guaranteed', 'will reach', 'will get', 'will go viral',
] as const;

export const YOUTUBE_IDEA_RARITY_CLAIMS = [
  'it ai biet', 'it nguoi biet', 'it nguoi tung nghe', 'little-known', 'nobody knows', 'hidden history',
] as const;
export const YOUTUBE_IDEA_UNSUPPORTED_DEMAND_CLAIMS = [
  'nhu cau tim kiem dang tang', 'nhu cau dang tang', 'luot tim kiem dang tang', 'luong tim kiem cao',
  'nhieu nguoi dang tim', 'nhieu nguoi tim kiem', 'dang la xu huong', 'dang thinh hanh', 'duoc quan tam nhieu',
  'rising search demand', 'search demand is rising', 'search volume is increasing', 'high search volume',
  'many people are searching', 'trending search', 'popular topic', 'high demand',
] as const;
export const YOUTUBE_IDEA_SURVIVOR_ABSOLUTE_MIN = 2;
export const YOUTUBE_IDEA_HEARTBEAT_INTERVAL_MS = 30_000;
export const YOUTUBE_IDEA_MAX_HEARTBEATS_PER_STEP = 20;

const CandidateListSchema = z.object({ ideas: z.array(z.unknown()).max(12) }).strict();
const CritiqueRowSchema = z.object({
  id: z.string().trim().min(1).max(80),
  decision: z.enum(['keep', 'drop']),
  rejectionReason: z.string().trim().min(1).max(300).optional(),
  scores: YoutubeIdeaScoresSchema,
}).strict().superRefine((row, context) => {
  if (row.decision === 'drop' && !row.rejectionReason) context.addIssue({ code: 'custom', path: ['rejectionReason'], message: 'A rejected candidate needs a reason.' });
});

export type YoutubeIdeaBackend = {
  kind: 'cli' | 'api';
  model: string;
  chat: (messages: ChatMessage[], options?: { stepLabel?: string }) => Promise<string>;
};

export type YoutubeIdeaJobContext = {
  reportProgress: (percent: number, result?: unknown) => Promise<void>;
  isCancelled: () => Promise<boolean>;
  appendLog: (message: string) => Promise<void>;
  markCommitComplete?: () => void;
};

type InvalidRow = { id: string; reason: string; value?: unknown };
type ParsedRows<T> = { valid: T[]; invalid: InvalidRow[] };
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function normalizeVietnamese(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/giu, 'd').toLocaleLowerCase('vi-VN');
}

function splitNumbers(value: string): string[] {
  return [...value.matchAll(/(?<![\p{L}\p{N}])(\d[\d.,]*\d|\d)(?![\p{L}\p{N}])/gu)]
    .map((match) => (match[1] ?? '').replace(/[.,]/gu, ''))
    .filter(Boolean);
}

function titleRows(packet: YoutubeIdeaPacket): string[] {
  const rows: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 6 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const child of value) visit(child, depth + 1); return; }
    const record = value as JsonObject;
    if (typeof record.title === 'string') rows.push(record.title);
    for (const child of Object.values(record)) visit(child, depth + 1);
  };
  visit(object(packet.packet).coverage, 0);
  return rows;
}

export function validateYoutubeIdea(value: unknown, packet: YoutubeIdeaPacket): { idea: YoutubeIdea | null; reasons: string[] } {
  const raw = object(value);
  if (raw.presetId === 'hubris-trap') {
    const rawMotif = object(raw.motif);
    const required = ['hunter', 'perfectPlan', 'blindSpot', 'selfDestruction'];
    if (required.some((key) => !rawMotif[key] || typeof object(rawMotif[key]).text !== 'string' || !object(rawMotif[key]).text)) {
      return { idea: null, reasons: ['không đủ khớp mẫu: thiếu mắt xích của hubris-trap.'] };
    }
  }
  const parsed = YoutubeIdeaSchema.safeParse(value);
  if (!parsed.success) return { idea: null, reasons: [`schema: ${parsed.error.issues.slice(0, 4).map((issue) => issue.path.join('.') || issue.message).join(', ')}`] };
  const idea = parsed.data;
  const reasons: string[] = [];
  if (idea.evidenceTier !== packet.evidenceTier) reasons.push('bậc chứng cứ của ý tưởng không khớp với gói dữ liệu.');
  const request = object(object(packet.packet).request);
  if (typeof request.targetDurationSec === 'number' && idea.suggestedDurationSec > request.targetDurationSec) {
    reasons.push('Thời lượng gợi ý vượt quá thời lượng mục tiêu của yêu cầu.');
  }
  if (idea.presetId !== request.presetId) reasons.push('Preset của ý tưởng không khớp lựa chọn; không tự đổi preset.');
  const matches = findDuplicateTitle(idea.title, titleRows(packet));
  if (matches.length) reasons.push(`Tiêu đề trùng hoặc gần trùng với nội dung đã lưu: ${matches[0]}.`);
  const packetNumbers = new Set(splitNumbers(packet.serialized));
  const unsupportedNumbers = splitNumbers(idea.whyForThisChannel).filter((number) => !packetNumbers.has(number));
  if (unsupportedNumbers.length) reasons.push(`Phần giải thích hợp kênh có số chưa có trong gói dữ liệu: ${[...new Set(unsupportedNumbers)].join(', ')}.`);
  const verifiedOrFlaggedNumbers = new Set([...packetNumbers, ...splitNumbers(idea.unverifiedFacts.join(' '))]);
  const narrativeNumbers = [
    idea.title, idea.hook, idea.brief, idea.successCriterion.description,
    ...Object.values(idea.motif ?? {}).map((link) => link.text), ...idea.risks,
  ].flatMap(splitNumbers).filter((number) => !verifiedOrFlaggedNumbers.has(number));
  if (narrativeNumbers.length) reasons.push(`Số trong phần kể chưa có trong gói dữ liệu hoặc danh sách cần kiểm chứng: ${[...new Set(narrativeNumbers)].join(', ')}.`);

  const prose = [
    idea.title, idea.hook, idea.brief, idea.whyForThisChannel, idea.successCriterion.description,
    ...Object.values(idea.motif ?? {}).map((link) => link.text),
    ...idea.unverifiedFacts, ...idea.risks,
  ].join(' ');
  const normalizedProse = normalizeVietnamese(prose);
  const promise = YOUTUBE_IDEA_FORBIDDEN_PROMISES.find((phrase) => normalizedProse.includes(normalizeVietnamese(phrase)));
  if (promise) reasons.push(`Có câu hứa hẹn hoặc dự đoán không được phép: ${promise}.`);
  const demandClaim = YOUTUBE_IDEA_UNSUPPORTED_DEMAND_CLAIMS.find((phrase) => normalizedProse.includes(normalizeVietnamese(phrase)));
  if (demandClaim) reasons.push(`Có khẳng định về nhu cầu hoặc độ phổ biến không được gói dữ liệu hỗ trợ: ${demandClaim}.`);
  const normalizedClaimText = normalizeVietnamese(`${idea.title} ${idea.brief}`);
  const rarityClaim = YOUTUBE_IDEA_RARITY_CLAIMS.find((phrase) => normalizedClaimText.includes(normalizeVietnamese(phrase)));
  if (rarityClaim) reasons.push(`ước đoán độ hiếm chỉ được ghi ở trường riêng, không được nêu như sự thật: ${rarityClaim}.`);

  if (idea.presetId === 'hubris-trap') {
    const motif = object(idea.motif);
    const required = ['hunter', 'perfectPlan', 'blindSpot', 'selfDestruction'];
    if (required.some((key) => !motif[key] || typeof object(motif[key]).text !== 'string' || !object(motif[key]).text)) {
      reasons.push('không đủ khớp mẫu: thiếu mắt xích của hubris-trap.');
    } else {
      const nonThin = required.filter((key) => object(motif[key]).evidence === 'strong' || object(motif[key]).evidence === 'partial').length;
      if (nonThin < 2) reasons.push('không đủ khớp mẫu: hubris-trap cần ít nhất hai mắt xích không mỏng.');
    }
  }
  return { idea: reasons.length ? null : idea, reasons };
}

function parseJson(raw: string): { value: unknown; error?: string } {
  try { return { value: parseJsonWithLeadingText(raw) }; }
  catch { return { value: null, error: 'JSON không hợp lệ.' }; }
}

function parseRows<T>(value: unknown, rowSchema: z.ZodType<T>, validateRow?: (row: T) => string[]): ParsedRows<T> {
  const root = CandidateListSchema.safeParse(value);
  if (!root.success) return { valid: [], invalid: [{ id: 'root', reason: `Cấu trúc đầu ra không hợp lệ: ${root.error.issues[0]?.message ?? 'schema'}`, value }] };
  const valid: T[] = [];
  const invalid: InvalidRow[] = [];
  for (const [index, row] of root.data.ideas.entries()) {
    const result = rowSchema.safeParse(row);
    if (result.success) {
      const reasons = validateRow?.(result.data) ?? [];
      if (reasons.length) invalid.push({ id: String(object(result.data).id ?? `row-${index + 1}`), reason: reasons.join(' '), value: row });
      else valid.push(result.data);
    }
    else {
      const rowObject = object(row);
      invalid.push({
        id: typeof rowObject.id === 'string' && rowObject.id.length <= 80 ? rowObject.id : `row-${index + 1}`,
        reason: `Schema: ${result.error.issues.slice(0, 4).map((issue) => issue.path.join('.') || issue.message).join(', ')}`,
        value: row,
      });
    }
  }
  return { valid, invalid };
}

function mergeRows<T>(original: T[], repaired: T[], getId: (row: T) => string): T[] {
  const merged = new Map(original.map((row) => [getId(row), row]));
  for (const row of repaired) merged.set(getId(row), row);
  return [...merged.values()];
}

function uniqueDropped(rows: YoutubeIdeaDropped[]): YoutubeIdeaDropped[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.id}\u0000${row.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

async function ask(input: {
  stage: 'generate' | 'critique'; packet: YoutubeIdeaPacket; backend: YoutubeIdeaBackend; context: YoutubeIdeaJobContext;
  candidatesJson?: string; repair?: { invalidItems: InvalidRow[]; originalOutput: unknown; error?: string };
}): Promise<string | undefined> {
  if (await input.context.isCancelled()) return undefined;
  const messages = buildYoutubeIdeaMessages({
    stage: input.stage,
    packetJson: input.packet.serialized,
    ...(input.candidatesJson ? { candidatesJson: input.candidatesJson } : {}),
    ...(input.repair ? { repair: input.repair } : {}),
  });
  const stepNumber = input.stage === 'generate' ? 1 : 2;
  const stepName = input.stage === 'generate' ? 'Sinh ý tưởng' : 'Phản biện và chọn lọc';
  const label = `Bước ${stepNumber}/2 — ${stepName}`;
  const promptBytes = messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0);
  const started = Date.now();
  await input.context.appendLog(`${label}: gửi yêu cầu (${promptBytes} byte).`);
  let heartbeatCount = 0;
  let heartbeat: Promise<void> | null = null;
  let heartbeatError: unknown;
  const timer = setInterval(() => {
    if (heartbeat || heartbeatCount >= YOUTUBE_IDEA_MAX_HEARTBEATS_PER_STEP) { if (heartbeatCount >= YOUTUBE_IDEA_MAX_HEARTBEATS_PER_STEP) clearInterval(timer); return; }
    heartbeat = (async () => {
      if (await input.context.isCancelled()) return;
      heartbeatCount += 1;
      await input.context.appendLog(`${label}: vẫn đang chờ (${Math.floor((Date.now() - started) / 1000)} giây).`);
      if (heartbeatCount >= YOUTUBE_IDEA_MAX_HEARTBEATS_PER_STEP) clearInterval(timer);
    })().catch((error: unknown) => { heartbeatError = error; clearInterval(timer); }).finally(() => { heartbeat = null; });
  }, YOUTUBE_IDEA_HEARTBEAT_INTERVAL_MS);
  let raw: string;
  try {
    raw = await input.backend.chat(messages, { stepLabel: `${input.stage === 'generate' ? 'video-ideas-generate' : 'video-ideas-critique'}${input.repair ? '-repair' : ''}` });
  } catch (error) {
    if (await input.context.isCancelled()) return undefined;
    throw error;
  } finally {
    clearInterval(timer);
    if (heartbeat) await heartbeat;
  }
  if (heartbeatError) throw heartbeatError;
  if (await input.context.isCancelled()) return undefined;
  await input.context.appendLog(`${label}: nhận phản hồi sau ${Math.floor((Date.now() - started) / 1000)} giây (${Buffer.byteLength(raw, 'utf8')} byte).`);
  return raw;
}

async function parseStage<T>(input: {
  stage: 'generate' | 'critique'; packet: YoutubeIdeaPacket; backend: YoutubeIdeaBackend; context: YoutubeIdeaJobContext;
  candidatesJson?: string; rowSchema: z.ZodType<T>;
  validateRow?: (row: T) => string[];
}): Promise<{ rows: T[]; invalid: InvalidRow[]; cancelled: boolean }> {
  const raw = await ask(input);
  if (raw === undefined) return { rows: [], invalid: [], cancelled: true };
  const parsed = parseJson(raw);
  const original = parsed.value;
  const first = parseRows(original, input.rowSchema, input.validateRow);
  const invalid = [...first.invalid];
  if (parsed.error && !invalid.length) invalid.push({ id: 'root', reason: parsed.error, value: raw });
  let validRows = first.valid;
  if (invalid.length) {
    await input.context.appendLog(`${input.stage === 'generate' ? 'Sinh ý tưởng' : 'Phản biện'}: có ${invalid.length} mục chưa đúng schema; thử một lần sửa.`);
    const repairedRaw = await ask({
      ...input,
      repair: { invalidItems: invalid, originalOutput: original ?? raw, ...(parsed.error ? { error: parsed.error } : {}) },
    });
    if (repairedRaw === undefined) return { rows: [], invalid, cancelled: true };
    const repairedParsed = parseJson(repairedRaw);
    const repaired = parseRows(repairedParsed.value, input.rowSchema, input.validateRow);
    const getId = (row: T) => String(object(row).id ?? '');
    validRows = mergeRows(validRows, repaired.valid, getId);
    const repairedIds = new Set(repaired.valid.map(getId));
    const stillInvalid = invalid.filter((row) => !repairedIds.has(row.id));
    const newlyInvalid = repaired.invalid.filter((row) => !invalid.some((old) => old.id === row.id));
    return { rows: validRows, invalid: [...stillInvalid, ...newlyInvalid], cancelled: false };
  }
  return { rows: validRows, invalid: [], cancelled: false };
}

export async function runYoutubeIdeaPipeline(input: {
  packet: YoutubeIdeaPacket; backend: YoutubeIdeaBackend; context: YoutubeIdeaJobContext;
  request: { count: number; presetId: string };
}): Promise<{ ideas: YoutubeIdea[]; dropped: YoutubeIdeaDropped[]; durations: { generateMs: number; critiqueMs: number; totalMs: number }; promptVersion: 'video-ideas-v1' } | undefined> {
  const startedAt = Date.now();
  const dropped: YoutubeIdeaDropped[] = [];
  const drop = (id: string, reason: string) => dropped.push({ id: id.slice(0, 80) || 'unknown', reason: reason.slice(0, 300) });

  const generateStarted = Date.now();
  await input.context.reportProgress(5, { step: 'Sinh ý tưởng' });
  const generated = await parseStage({
    stage: 'generate', packet: input.packet, backend: input.backend, context: input.context,
    rowSchema: YoutubeIdeaDraftSchema,
    validateRow: (row) => validateYoutubeIdea({ ...row, scores: { fit: 0, clarity: 0, riskOfThinSources: 0 } }, input.packet).reasons,
  });
  const generateMs = Date.now() - generateStarted;
  if (generated.cancelled || await input.context.isCancelled()) return undefined;
  for (const invalid of generated.invalid) drop(invalid.id, invalid.reason);

  const candidates = new Map<string, YoutubeIdeaDraft>();
  for (const row of generated.rows) {
    const candidate = row as YoutubeIdeaDraft;
    if (candidates.has(candidate.id)) { drop(candidate.id, 'Mã ý tưởng bị trùng trong lượt sinh.'); continue; }
    const result = validateYoutubeIdea({ ...candidate, scores: { fit: 0, clarity: 0, riskOfThinSources: 0 } }, input.packet);
    if (result.reasons.length) {
      drop(candidate.id, result.reasons.join(' '));
      continue;
    }
    const duplicateWithinRun = findDuplicateTitle(candidate.title, [...titleRows(input.packet), ...[...candidates.values()].map((row) => row.title)]);
    if (duplicateWithinRun.length) { drop(candidate.id, `Tiêu đề trùng hoặc gần trùng với nội dung đã đề xuất trong lượt này: ${duplicateWithinRun[0]}.`); continue; }
    candidates.set(candidate.id, candidate);
  }
  if (candidates.size === 0) throw new AppError('Không có ý tưởng nào đủ đúng cấu trúc và an toàn để phản biện. Hãy thử lại với chỉ dẫn khác.', 422, 'YOUTUBE_IDEAS_UNGROUNDED');

  const critiqueStarted = Date.now();
  await input.context.reportProgress(45, { step: 'Phản biện và chọn lọc' });
  const critique = await parseStage({
    stage: 'critique', packet: input.packet, backend: input.backend, context: input.context,
    candidatesJson: JSON.stringify([...candidates.values()]), rowSchema: CritiqueRowSchema,
  });
  const critiqueMs = Date.now() - critiqueStarted;
  if (critique.cancelled || await input.context.isCancelled()) return undefined;
  for (const invalid of critique.invalid) drop(invalid.id, invalid.reason);
  const reviewed = new Map<string, z.infer<typeof CritiqueRowSchema>>();
  for (const rawRow of critique.rows) {
    const row = rawRow as z.infer<typeof CritiqueRowSchema>;
    if (!candidates.has(row.id)) { drop(row.id, 'Phản biện tham chiếu mã ý tưởng không có trong lượt sinh.'); continue; }
    if (reviewed.has(row.id)) { drop(row.id, 'Phản biện trả về mã ý tưởng trùng lặp.'); continue; }
    reviewed.set(row.id, row);
  }
  for (const id of candidates.keys()) if (!reviewed.has(id)) drop(id, 'Phản biện không đưa ra quyết định cho ý tưởng này.');

  const selected: YoutubeIdea[] = [];
  for (const [id, review] of reviewed) {
    if (review.decision === 'drop') { drop(id, review.rejectionReason ?? 'Bị loại sau phản biện.'); continue; }
    const candidate = candidates.get(id)!;
    const validated = validateYoutubeIdea({ ...candidate, scores: review.scores }, input.packet);
    if (!validated.idea) { drop(id, validated.reasons.join(' ')); continue; }
    if (selected.length >= input.request.count) { drop(id, 'Vượt số lượng ý tưởng được yêu cầu.'); continue; }
    selected.push(validated.idea);
  }
  const minimum = Math.max(YOUTUBE_IDEA_SURVIVOR_ABSOLUTE_MIN, Math.ceil(input.request.count / 2));
  if (selected.length < minimum) {
    await input.context.appendLog(`Chỉ còn ${selected.length} ý tưởng đạt yêu cầu; cần ít nhất ${minimum}. Không lưu danh sách mỏng.`);
    throw new AppError(`Chỉ còn ${selected.length} ý tưởng đủ căn cứ; cần ít nhất ${minimum}. Hãy đổi chỉ dẫn hoặc kiểm tra nguồn trước khi tạo dự án.`, 422, 'YOUTUBE_IDEAS_UNGROUNDED');
  }
  if (await input.context.isCancelled()) return undefined;
  await input.context.appendLog(`Đã chọn ${selected.length}/${input.request.count} ý tưởng; bỏ ${uniqueDropped(dropped).length} mục.`);
  await input.context.reportProgress(95, { step: 'Đã hoàn tất chọn lọc', accepted: selected.length, dropped: uniqueDropped(dropped).length });
  return {
    ideas: selected,
    dropped: uniqueDropped(dropped),
    durations: { generateMs, critiqueMs, totalMs: Date.now() - startedAt },
    promptVersion: 'video-ideas-v1',
  };
}

export const YOUTUBE_IDEA_STAGE_PROMPTS = YOUTUBE_IDEA_PROMPT_VERSIONS;
