import { z } from 'zod';
import {
  YoutubeIdeaDraftSchema,
  YoutubeIdeaScoresSchema,
  YoutubeIdeaV2Schema,
  type YoutubeIdea,
  type YoutubeIdeaDropped,
  type YoutubeIdeaV2,
} from '../../../contracts/youtube-ideas';
import { findDuplicateTitle } from '../../../contracts/seo-duplicates';
import type { ChatMessage } from '../../shared/ai';
import { AppError } from '../../shared/errors';
import { parseJsonWithLeadingText } from '../../shared/claude-cli/json-output';
import { buildYoutubeIdeaV2Messages, YOUTUBE_IDEA_V2_PROMPT_VERSIONS } from './idea-prompts';
import type { YoutubeIdeaPacket } from './idea-packet';
import {
  createIdeaAvoidList,
  filterYoutubeIdeaSeeds,
  isYoutubeIdeaPeriodRefinement,
  normalizeYoutubeIdeaStageOutput,
  trimYoutubeIdeaV2Final,
  validateYoutubeIdeaV2,
  type YoutubeIdeaSeed,
  type YoutubeIdeaStage,
} from './idea-quality';

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
export const YOUTUBE_IDEA_MAX_EXPAND_BATCHES = 3;
export const YOUTUBE_IDEA_MAX_SHORTLIST = 12;
export const YOUTUBE_IDEA_EXPANSION_BATCH_SIZE = 4;
const configuredIdeaBudgetSec = Number(process.env.IDEA_JOB_SOFT_BUDGET_SEC ?? 240);
export const IDEA_JOB_SOFT_BUDGET_SEC = Number.isInteger(configuredIdeaBudgetSec) && configuredIdeaBudgetSec > 0 && configuredIdeaBudgetSec <= 3600
  ? configuredIdeaBudgetSec
  : 240;
export const YOUTUBE_IDEA_HEARTBEAT_INTERVAL_MS = 30_000;
export const YOUTUBE_IDEA_MAX_HEARTBEATS_PER_STEP = 20;

export const YoutubeIdeaSeedSchema = z.object({
  id: z.string().trim().min(1).max(80),
  episode: z.string().trim().min(1).max(160),
  yearOrPeriod: z.string().trim().min(1).max(80),
  place: z.string().trim().min(1).max(100),
  hunterArchetype: z.enum(['military', 'political', 'economic', 'technological', 'diplomatic', 'institutional', 'other']),
  domain: z.string().trim().min(1).max(80),
  famousnessGuess: z.enum(['famous', 'known', 'obscure', 'unknown']),
}).strict();

const SelectedIdeaSeedSchema = z.object({ id: z.string().trim().min(1).max(80), trapSketch: z.string().trim().min(1).max(280) }).strict();
const RejectedIdeaSeedSchema = z.object({ id: z.string().trim().min(1).max(80), rejectionReason: z.string().trim().min(1).max(300) }).strict();
const SelectionResponseSchema = z.object({
  selected: z.array(SelectedIdeaSeedSchema).max(YOUTUBE_IDEA_MAX_SHORTLIST),
  rejected: z.array(RejectedIdeaSeedSchema).max(24).default([]),
}).strict();

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
type ParsedRows<T> = { valid: T[]; invalid: InvalidRow[]; original: unknown };
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function normalizeVietnamese(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/giu, 'd').toLocaleLowerCase('vi-VN');
}

function episodeComparisonKey(value: string): string {
  return normalizeVietnamese(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/gu, ' ');
}

function alreadyProposedEpisodes(packet: YoutubeIdeaPacket): string[] {
  const values = object(packet.packet).alreadyProposedEpisodes;
  return Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string').slice(0, 40) : [];
}

function mechanicalExpansionRepair(reason: string): boolean {
  return /^(?:Schema:|JSON không hợp lệ|Cấu trúc ideas|Bản chi tiết thiếu)/u.test(reason)
    || /(?:số chưa có claim|tên chưa có claim|mệnh đề nhân quả chưa có claim)/u.test(reason);
}

function topDropReasons(rows: YoutubeIdeaDropped[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => ({ reason, count })).sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason)).slice(0, 3);
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

/** Legacy v1 validation stays available for old stored records and regression coverage. */
export function validateYoutubeIdea(value: unknown, packet: YoutubeIdeaPacket): { idea: YoutubeIdea | null; reasons: string[] } {
  const raw = object(value);
  if (raw.presetId === 'hubris-trap') {
    const rawMotif = object(raw.motif);
    const required = ['hunter', 'perfectPlan', 'blindSpot', 'selfDestruction'];
    if (required.some((key) => !rawMotif[key] || typeof object(rawMotif[key]).text !== 'string' || !object(rawMotif[key]).text)) {
      return { idea: null, reasons: ['không đủ khớp mẫu: thiếu mắt xích của hubris-trap.'] };
    }
  }
  const parsed = YoutubeIdeaDraftSchema.extend({ scores: YoutubeIdeaScoresSchema }).safeParse(value);
  if (!parsed.success) return { idea: null, reasons: [`schema: ${parsed.error.issues.slice(0, 4).map((issue) => issue.path.join('.') || issue.message).join(', ')}`] };
  const idea = parsed.data;
  const reasons = validateLegacyIdeaSemantics(idea, packet);
  return { idea: reasons.length ? null : idea, reasons };
}

function validateLegacyIdeaSemantics(idea: YoutubeIdea, packet: YoutubeIdeaPacket): string[] {
  const reasons: string[] = [];
  if (idea.evidenceTier !== packet.evidenceTier) reasons.push('bậc chứng cứ của ý tưởng không khớp với gói dữ liệu.');
  const request = object(object(packet.packet).request);
  if (typeof request.targetDurationSec === 'number' && idea.suggestedDurationSec > request.targetDurationSec) reasons.push('Thời lượng gợi ý vượt quá thời lượng mục tiêu của yêu cầu.');
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
    ...Object.values(idea.motif ?? {}).map((link) => link.text), ...idea.unverifiedFacts, ...idea.risks,
  ].join(' ');
  const normalizedProse = normalizeVietnamese(prose);
  const promise = YOUTUBE_IDEA_FORBIDDEN_PROMISES.find((phrase) => normalizedProse.includes(normalizeVietnamese(phrase)));
  if (promise) reasons.push(`Có câu hứa hẹn hoặc dự đoán không được phép: ${promise}.`);
  const demand = YOUTUBE_IDEA_UNSUPPORTED_DEMAND_CLAIMS.find((phrase) => normalizedProse.includes(normalizeVietnamese(phrase)));
  if (demand) reasons.push(`Có khẳng định về nhu cầu hoặc độ phổ biến không được gói dữ liệu hỗ trợ: ${demand}.`);
  const rarity = YOUTUBE_IDEA_RARITY_CLAIMS.find((phrase) => normalizeVietnamese(`${idea.title} ${idea.brief}`).includes(normalizeVietnamese(phrase)));
  if (rarity) reasons.push(`ước đoán độ hiếm chỉ được ghi ở trường riêng, không được nêu như sự thật: ${rarity}.`);
  if (idea.presetId === 'hubris-trap') {
    const links = Object.values(idea.motif ?? {});
    if (links.filter((link) => link.evidence !== 'thin').length < 2) reasons.push('không đủ khớp mẫu: hubris-trap cần ít nhất hai mắt xích không mỏng.');
  }
  return reasons;
}

function legacyShape(idea: YoutubeIdeaV2): YoutubeIdea {
  return {
    id: idea.id,
    title: idea.title,
    hook: idea.hook,
    brief: idea.brief,
    presetId: idea.presetId,
    motif: idea.motif,
    whyForThisChannel: idea.whyForThisChannel,
    testVariable: idea.testVariable,
    successCriterion: idea.successCriterion,
    unverifiedFacts: idea.claims.map((claim) => claim.text),
    risks: idea.risks,
    rarityGuess: idea.rarityGuess,
    evidenceTier: idea.evidenceTier,
    scores: idea.scores,
    suggestedDurationSec: idea.suggestedDurationSec,
    suggestedChapterCount: idea.suggestedChapterCount,
  };
}

function validateCompleteIdea(value: unknown, packet: YoutubeIdeaPacket): { idea: YoutubeIdeaV2 | null; reasons: string[] } {
  const checked = validateYoutubeIdeaV2(value, packet);
  if (!checked.idea) return checked;
  const reasons = validateLegacyIdeaSemantics(legacyShape(checked.idea), packet);
  return { idea: reasons.length ? null : checked.idea, reasons };
}

export function validateYoutubeIdeaV2Complete(value: unknown, packet: YoutubeIdeaPacket): { idea: YoutubeIdeaV2 | null; reasons: string[] } {
  return validateCompleteIdea(value, packet);
}

function parseJson(raw: string): { value: unknown; error?: string } {
  try { return { value: parseJsonWithLeadingText(raw) }; }
  catch { return { value: null, error: 'JSON không hợp lệ.' }; }
}

function issueText(error: z.ZodError): string {
  return error.issues.slice(0, 6).map((issue) => issue.path.join('.') || issue.message).join(', ');
}

function parseArrayRows<T>(stage: 'seeds' | 'expand', value: unknown, rowSchema: z.ZodType<T>, validateRow?: (row: T) => string[]): ParsedRows<T> {
  const parsed = parseJson(typeof value === 'string' ? value : '');
  const original = parsed.value ?? value;
  if (parsed.error) return { valid: [], invalid: [{ id: 'root', reason: parsed.error, value }], original };
  const normalized = normalizeYoutubeIdeaStageOutput(stage, parsed.value);
  const root = object(normalized);
  const key = stage === 'seeds' ? 'seeds' : 'ideas';
  const rows = root[key];
  if (!Array.isArray(rows)) return { valid: [], invalid: [{ id: 'root', reason: `Cấu trúc ${key} không hợp lệ.`, value: parsed.value }], original: parsed.value };
  const max = stage === 'seeds' ? 24 : 4;
  if (rows.length > max) return { valid: [], invalid: [{ id: 'root', reason: `Số mục vượt giới hạn ${max}.`, value: parsed.value }], original: parsed.value };
  const valid: T[] = [];
  const invalid: InvalidRow[] = [];
  for (const [index, item] of rows.entries()) {
    const result = rowSchema.safeParse(item);
    if (!result.success) {
      const row = object(item);
      invalid.push({ id: typeof row.id === 'string' && row.id.length <= 80 ? row.id : `${stage}-${index + 1}`, reason: `Schema: ${issueText(result.error)}.`, value: item });
      continue;
    }
    const reasons = validateRow?.(result.data) ?? [];
    if (reasons.length) invalid.push({ id: String(object(result.data).id ?? `${stage}-${index + 1}`), reason: reasons.join(' '), value: item });
    else valid.push(result.data);
  }
  return { valid, invalid, original: parsed.value };
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

const STEP_NAMES: Record<YoutubeIdeaStage, string> = {
  seeds: 'Ý tưởng sơ bộ', select: 'Chọn lọc', expand: 'Viết chi tiết',
};
const STEP_PERCENT: Record<YoutubeIdeaStage, number> = { seeds: 5, select: 35, expand: 60 };

async function ask(input: {
  stage: YoutubeIdeaStage; packet: YoutubeIdeaPacket; backend: YoutubeIdeaBackend; context: YoutubeIdeaJobContext;
  avoidList?: readonly string[]; seedsJson?: string; selectedSeedsJson?: string; expansionHint?: string;
  repair?: { invalidItems: InvalidRow[]; originalOutput: unknown; error?: string };
}): Promise<string | undefined> {
  if (await input.context.isCancelled()) return undefined;
  const messages = buildYoutubeIdeaV2Messages({
    stage: input.stage,
    packetJson: input.packet.serialized,
    avoidList: input.avoidList,
    seedsJson: input.seedsJson,
    selectedSeedsJson: input.selectedSeedsJson,
    expansionHint: input.expansionHint,
    ...(input.repair ? { repair: input.repair } : {}),
  });
  const stepName = STEP_NAMES[input.stage];
  const label = `Bước ${input.stage === 'seeds' ? 1 : input.stage === 'select' ? 2 : 3}/3 — ${stepName}`;
  const promptBytes = messages.reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0);
  const started = Date.now();
  await input.context.appendLog(`${label}: gửi yêu cầu (${promptBytes} byte).`);
  let heartbeatCount = 0;
  let heartbeat: Promise<void> | null = null;
  let heartbeatError: unknown;
  const timer = setInterval(() => {
    if (heartbeat || heartbeatCount >= YOUTUBE_IDEA_MAX_HEARTBEATS_PER_STEP) {
      if (heartbeatCount >= YOUTUBE_IDEA_MAX_HEARTBEATS_PER_STEP) clearInterval(timer);
      return;
    }
    heartbeat = (async () => {
      if (await input.context.isCancelled()) return;
      heartbeatCount += 1;
      await input.context.appendLog(`${label}: vẫn đang chờ (${Math.floor((Date.now() - started) / 1000)} giây).`);
      if (heartbeatCount >= YOUTUBE_IDEA_MAX_HEARTBEATS_PER_STEP) clearInterval(timer);
    })().catch((error: unknown) => { heartbeatError = error; clearInterval(timer); }).finally(() => { heartbeat = null; });
  }, YOUTUBE_IDEA_HEARTBEAT_INTERVAL_MS);
  let raw: string;
  try {
    raw = await input.backend.chat(messages, { stepLabel: `${YOUTUBE_IDEA_V2_PROMPT_VERSIONS[input.stage]}${input.repair ? '-repair' : ''}` });
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

async function repairRows<T>(input: {
  stage: 'seeds' | 'expand'; packet: YoutubeIdeaPacket; backend: YoutubeIdeaBackend; context: YoutubeIdeaJobContext;
  avoidList?: readonly string[]; selectedSeedsJson?: string; initial: ParsedRows<T>;
  parse: (value: unknown) => ParsedRows<T>; getId: (row: T) => string;
}): Promise<{ rows: T[]; invalid: InvalidRow[]; cancelled: boolean; repairCalls: number }> {
  if (!input.initial.invalid.length) return { rows: input.initial.valid, invalid: [], cancelled: false, repairCalls: 0 };
  await input.context.appendLog(`${STEP_NAMES[input.stage]}: ${input.initial.invalid.length} mục chưa hợp lệ sau khi chuẩn hóa; thử một lần sửa.`);
  const repairRaw = await ask({
    stage: input.stage, packet: input.packet, backend: input.backend, context: input.context,
    avoidList: input.avoidList, selectedSeedsJson: input.selectedSeedsJson,
    repair: { invalidItems: input.initial.invalid, originalOutput: input.initial.original },
  });
  if (repairRaw === undefined) return { rows: [], invalid: input.initial.invalid, cancelled: true, repairCalls: 1 };
  const repaired = input.parse(repairRaw);
  const rows = mergeRows(input.initial.valid, repaired.valid, input.getId);
  const repairedIds = new Set(repaired.valid.map(input.getId));
  const stillInvalid = input.initial.invalid.filter((row) => !repairedIds.has(row.id));
  const newlyInvalid = repaired.invalid.filter((row) => !input.initial.invalid.some((old) => old.id === row.id));
  return { rows, invalid: [...stillInvalid, ...newlyInvalid], cancelled: false, repairCalls: 1 };
}

function parseSelection(value: unknown, seeds: YoutubeIdeaSeed[], count: number): { selection: z.infer<typeof SelectionResponseSchema> | null; invalid: InvalidRow[]; original: unknown } {
  const parsed = parseJson(typeof value === 'string' ? value : '');
  if (parsed.error) return { selection: null, invalid: [{ id: 'root', reason: parsed.error, value }], original: value };
  const normalized = normalizeYoutubeIdeaStageOutput('select', parsed.value);
  const result = SelectionResponseSchema.safeParse(normalized);
  if (!result.success) return { selection: null, invalid: [{ id: 'root', reason: `Schema: ${issueText(result.error)}.`, value: parsed.value }], original: parsed.value };
  const expectedSelected = Math.min(YOUTUBE_IDEA_MAX_SHORTLIST, Math.ceil(count * 2), seeds.length);
  const seedIds = new Set(seeds.map((seed) => seed.id));
  const selectedIds = result.data.selected.map((row) => row.id);
  const rejectedIds = result.data.rejected.map((row) => row.id);
  const allIds = [...selectedIds, ...rejectedIds];
  const errors: string[] = [];
  if (selectedIds.length > expectedSelected) errors.push(`selected must not contain more than ${expectedSelected} seed IDs`);
  if (new Set(selectedIds).size !== selectedIds.length) errors.push('selected contains duplicate seed IDs');
  if (new Set(rejectedIds).size !== rejectedIds.length) errors.push('rejected contains duplicate seed IDs');
  if (allIds.some((id) => !seedIds.has(id))) errors.push('selection references an unknown seed ID');
  if (selectedIds.some((id) => rejectedIds.includes(id))) errors.push('a seed cannot be both selected and rejected');
  if (new Set(allIds).size !== seedIds.size || [...seedIds].some((id) => !allIds.includes(id))) errors.push('every unselected seed needs a rejection reason');
  if (errors.length) return { selection: null, invalid: [{ id: 'root', reason: `Selection validation: ${errors.join('; ')}.`, value: parsed.value }], original: parsed.value };
  return { selection: result.data, invalid: [], original: parsed.value };
}

async function runSelectionStage(input: {
  packet: YoutubeIdeaPacket; backend: YoutubeIdeaBackend; context: YoutubeIdeaJobContext; seeds: YoutubeIdeaSeed[]; count: number;
}): Promise<{ selection: z.infer<typeof SelectionResponseSchema> | null; invalid: InvalidRow[]; cancelled: boolean; repairCalls: number }> {
  const seedsJson = JSON.stringify(input.seeds);
  const raw = await ask({ stage: 'select', packet: input.packet, backend: input.backend, context: input.context, seedsJson });
  if (raw === undefined) return { selection: null, invalid: [], cancelled: true, repairCalls: 0 };
  const first = parseSelection(raw, input.seeds, input.count);
  if (first.selection) return { selection: first.selection, invalid: [], cancelled: false, repairCalls: 0 };
  await input.context.appendLog(`${STEP_NAMES.select}: đầu ra chưa đúng cấu trúc; thử một lần sửa.`);
  const repairedRaw = await ask({
    stage: 'select', packet: input.packet, backend: input.backend, context: input.context, seedsJson,
    repair: { invalidItems: first.invalid, originalOutput: first.original },
  });
  if (repairedRaw === undefined) return { selection: null, invalid: first.invalid, cancelled: true, repairCalls: 1 };
  const repaired = parseSelection(repairedRaw, input.seeds, input.count);
  return { selection: repaired.selection, invalid: repaired.selection ? [] : repaired.invalid, cancelled: false, repairCalls: 1 };
}

function selectionToSeeds(input: {
  selection: z.infer<typeof SelectionResponseSchema>; seeds: YoutubeIdeaSeed[]; count: number; steering: string;
}): { seeds: Array<YoutubeIdeaSeed & { trapSketch: string }>; dropped: YoutubeIdeaDropped[] } {
  const dropped = input.selection.rejected.map((row) => ({ id: row.id, reason: row.rejectionReason }));
  const seedById = new Map(input.seeds.map((seed) => [seed.id, seed]));
  const sketchById = new Map<string, string>();
  const selectedIds = new Set<string>();
  const candidates: Array<YoutubeIdeaSeed & { trapSketch: string }> = [];
  for (const row of input.selection.selected) {
    if (!seedById.has(row.id)) { dropped.push({ id: row.id, reason: 'Chọn lọc tham chiếu seed không có trong lượt chạy.' }); continue; }
    if (selectedIds.has(row.id)) { dropped.push({ id: row.id, reason: 'Chọn lọc trả về mã seed trùng.' }); continue; }
    if (candidates.length >= Math.min(YOUTUBE_IDEA_MAX_SHORTLIST, Math.ceil(input.count * 2))) { dropped.push({ id: row.id, reason: 'Vượt số seed được mở rộng.' }); continue; }
    selectedIds.add(row.id);
    sketchById.set(row.id, row.trapSketch);
    candidates.push({ ...seedById.get(row.id)!, trapSketch: row.trapSketch });
  }
  for (const row of input.seeds) {
    if (!selectedIds.has(row.id) && !input.selection.rejected.some((item) => item.id === row.id)) {
      dropped.push({ id: row.id, reason: 'Không được chọn; bộ lọc không nhận được lý do loại cụ thể.' });
    }
  }
  const diverse = filterYoutubeIdeaSeeds(candidates, input.count, input.steering);
  dropped.push(...diverse.dropped);
  const selected = diverse.seeds.map((seed) => ({ ...seed, trapSketch: sketchById.get(seed.id) ?? '' }));
  return { seeds: selected, dropped };
}

export type YoutubeIdeaPipelineResult = {
  ideas: YoutubeIdeaV2[];
  dropped: YoutubeIdeaDropped[];
  status: 'complete' | 'partial';
  diagnostics: {
    seedCount: number;
    shortlistedCount: number;
    expandedCount: number;
    validCount: number;
    expansionBatches: Array<{ index: number; seedCount: number; validCount: number; durationMs: number; repairCalls: number; repairRescues: number }>;
    repairRescues: number;
    budgetStopped: boolean;
    repairCalls: { seeds: number; select: number; expand: number };
  };
  durations: { seedsMs: number; selectMs: number; expandMs: number; totalMs: number };
  repairCalls: { seeds: number; select: number; expand: number };
  promptVersion: 'video-ideas-v2';
};

export async function runYoutubeIdeaPipeline(input: {
  packet: YoutubeIdeaPacket; backend: YoutubeIdeaBackend; context: YoutubeIdeaJobContext;
  request: { count: number; presetId: string };
  softBudgetSec?: number;
  clock?: () => number;
}): Promise<YoutubeIdeaPipelineResult | undefined> {
  const now = input.clock ?? Date.now;
  const startedAt = now();
  const budgetMs = (input.softBudgetSec ?? IDEA_JOB_SOFT_BUDGET_SEC) * 1000;
  const dropped: YoutubeIdeaDropped[] = [];
  const drop = (id: string, reason: string) => dropped.push({ id: id.slice(0, 80) || 'unknown', reason: reason.slice(0, 300) });
  const steering = typeof object(input.packet.packet).steering === 'string' ? String(object(input.packet.packet).steering) : '';
  const language = object(object(input.packet.packet).channel).language === 'en' ? 'en' : 'vi';
  const avoidList = createIdeaAvoidList(steering, language);
  const previousEpisodes = alreadyProposedEpisodes(input.packet);
  const previousEpisodeKeys = new Set(previousEpisodes.map(episodeComparisonKey));
  const failWithTopReasons = async (options: {
    step: string;
    fallback: string;
    seedCount: number;
    shortlistedCount: number;
    seedsMs: number;
    selectMs: number;
    repairCalls: { seeds: number; select: number; expand: number };
  }): Promise<never> => {
    const compactDropped = uniqueDropped(dropped);
    const reasonSummary = topDropReasons(compactDropped);
    const reasonsText = reasonSummary.map(({ reason, count }) => `${reason} (${count})`).join('; ') || options.fallback;
    const durations = { seedsMs: options.seedsMs, selectMs: options.selectMs, expandMs: 0, totalMs: now() - startedAt };
    const diagnostics: YoutubeIdeaPipelineResult['diagnostics'] = {
      seedCount: options.seedCount, shortlistedCount: options.shortlistedCount, expandedCount: 0, validCount: 0,
      expansionBatches: [], repairRescues: 0, budgetStopped: false, repairCalls: options.repairCalls,
    };
    const dropReasonCounts = Object.fromEntries(compactDropped.reduce((counts, row) => counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1), new Map<string, number>()));
    await input.context.reportProgress(95, { step: options.step, accepted: 0, dropped: compactDropped.length, dropReasonCounts, droppedRows: compactDropped, durations, diagnostics, status: 'failed' });
    await input.context.appendLog(`${options.fallback} Lý do chính: ${reasonsText}.`);
    throw new AppError(`${options.fallback} Lý do chính: ${reasonsText}.`, 422, 'YOUTUBE_IDEAS_UNGROUNDED');
  };

  const seedsStarted = now();
  await input.context.reportProgress(STEP_PERCENT.seeds, { step: STEP_NAMES.seeds });
  const seedRaw = await ask({ stage: 'seeds', packet: input.packet, backend: input.backend, context: input.context, avoidList });
  if (seedRaw === undefined || await input.context.isCancelled()) return undefined;
  const parseSeeds = (value: unknown) => parseArrayRows('seeds', value, YoutubeIdeaSeedSchema);
  const firstSeeds = parseSeeds(seedRaw);
  const generated = await repairRows({
    stage: 'seeds', packet: input.packet, backend: input.backend, context: input.context, avoidList,
    initial: firstSeeds, parse: parseSeeds, getId: (row) => row.id,
  });
  const seedsMs = now() - seedsStarted;
  if (generated.cancelled || await input.context.isCancelled()) return undefined;
  for (const invalid of generated.invalid) drop(invalid.id, invalid.reason);
  const distinctSeeds: YoutubeIdeaSeed[] = [];
  const seenSeedIds = new Set<string>();
  for (const row of generated.rows) {
    if (seenSeedIds.has(row.id)) { drop(row.id, 'Mã seed bị trùng trong lượt sinh.'); continue; }
    seenSeedIds.add(row.id);
    if (previousEpisodeKeys.has(episodeComparisonKey(row.episode))) { drop(row.id, 'Episode đã được đề xuất trong lượt chạy trước.'); continue; }
    distinctSeeds.push(row);
  }

  if (distinctSeeds.length === 0) {
    return failWithTopReasons({
      step: 'Không có seed hợp lệ', fallback: 'Không có tập sự kiện hợp lệ để chọn lọc.', seedCount: 0, shortlistedCount: 0,
      seedsMs, selectMs: 0, repairCalls: { seeds: generated.repairCalls, select: 0, expand: 0 },
    });
  }

  const selectStarted = now();
  await input.context.reportProgress(STEP_PERCENT.select, { step: STEP_NAMES.select });
  const selectedResponse = await runSelectionStage({ packet: input.packet, backend: input.backend, context: input.context, seeds: distinctSeeds, count: input.request.count });
  const selectMs = now() - selectStarted;
  if (selectedResponse.cancelled || await input.context.isCancelled()) return undefined;
  for (const invalid of selectedResponse.invalid) drop(invalid.id, invalid.reason);
  if (!selectedResponse.selection) {
    return failWithTopReasons({
      step: 'Không thể đọc kết quả chọn lọc', fallback: 'Không thể đọc kết quả chọn lọc; hãy thử lại.', seedCount: distinctSeeds.length,
      shortlistedCount: 0, seedsMs, selectMs, repairCalls: { seeds: generated.repairCalls, select: selectedResponse.repairCalls, expand: 0 },
    });
  }
  const selected = selectionToSeeds({ selection: selectedResponse.selection, seeds: distinctSeeds, count: input.request.count, steering });
  dropped.push(...selected.dropped);
  if (!selected.seeds.length) {
    return failWithTopReasons({
      step: 'Không còn seed qua lọc', fallback: 'Không còn episode nào vượt qua bộ lọc đa dạng và độ nổi tiếng.', seedCount: distinctSeeds.length,
      shortlistedCount: 0, seedsMs, selectMs, repairCalls: { seeds: generated.repairCalls, select: selectedResponse.repairCalls, expand: 0 },
    });
  }

  const expandStarted = now();
  await input.context.reportProgress(STEP_PERCENT.expand, { step: STEP_NAMES.expand });
  const expandedById = new Map<string, YoutubeIdeaV2>();
  const expansionBatches: Array<{ index: number; seedCount: number; validCount: number; durationMs: number; repairCalls: number; repairRescues: number }> = [];
  let expansionRepairCalls = 0;
  let repairRescues = 0;
  let expandedCount = 0;
  let budgetStopped = false;
  let offset = 0;
  while (offset < selected.seeds.length && expansionBatches.length < YOUTUBE_IDEA_MAX_EXPAND_BATCHES) {
    const running = trimYoutubeIdeaV2Final([...expandedById.values()], input.request.count, steering);
    if (running.ideas.length >= input.request.count) break;
    if (now() - startedAt >= budgetMs) {
      budgetStopped = true;
      await input.context.appendLog('Đã dừng thêm lượt viết chi tiết vì sắp hết thời gian dự kiến');
      break;
    }
    if (await input.context.isCancelled()) return undefined;
    const batchIndex = expansionBatches.length + 1;
    const batch = selected.seeds.slice(offset, offset + YOUTUBE_IDEA_EXPANSION_BATCH_SIZE);
    const batchStarted = now();
    const batchSeedsJson = JSON.stringify(batch);
    const archetypes = ['military', 'political', 'economic', 'technological', 'diplomatic', 'institutional', 'other'] as const;
    const presentArchetypes = new Set(running.ideas.map((idea) => idea.hunterArchetype));
    const presentCenturies = new Set(running.ideas.map((idea) => idea.period));
    const missingArchetypes = archetypes.filter((value) => !presentArchetypes.has(value));
    const expansionHint = running.ideas.length ? `Đang có ${running.ideas.length}/${input.request.count} ý hợp lệ. Archetype còn thiếu trong danh sách đang có: ${missingArchetypes.join(', ') || 'không có'}; ưu tiên archetype còn thiếu khi phù hợp, tránh lặp kỳ đã sống sót: ${[...presentCenturies].join(', ') || 'chưa có'}.` : undefined;
    const expected = new Map(batch.map((seed) => [seed.id, seed]));
    const parseExpanded = (value: unknown, requireAllRows = true) => {
      const seenIds = new Set<string>();
      const validateRow = (row: YoutubeIdeaV2): string[] => {
        const reasons: string[] = [];
        const seed = expected.get(row.id);
        if (!seed) return ['Bản chi tiết có mã seed không nằm trong batch.'];
        if (seenIds.has(row.id)) return ['Mã ý tưởng bị trùng trong batch.'];
        seenIds.add(row.id);
        const evidenceForPeriod = `${input.packet.serialized} ${row.claims.map((claim) => claim.text).join(' ')}`;
        if (!isYoutubeIdeaPeriodRefinement(seed.yearOrPeriod, row.period, evidenceForPeriod)) reasons.push('Thời kỳ trong bản chi tiết lệch seed đã chọn hoặc chưa có căn cứ để chi tiết hơn.');
        if (normalizeVietnamese(row.place) !== normalizeVietnamese(seed.place)) reasons.push('Địa điểm trong bản chi tiết lệch seed đã chọn.');
        if (row.hunterArchetype !== seed.hunterArchetype) reasons.push('Archetype trong bản chi tiết lệch seed đã chọn.');
        if (row.famousnessGuess !== seed.famousnessGuess) reasons.push('Ước đoán độ nổi tiếng trong bản chi tiết lệch seed đã chọn.');
        reasons.push(...validateCompleteIdea(row, input.packet).reasons);
        return reasons;
      };
      const parsed = parseArrayRows('expand', value, YoutubeIdeaV2Schema, validateRow);
      if (requireAllRows) {
        const returnedIds = new Set([...parsed.valid.map((row) => row.id), ...parsed.invalid.map((row) => row.id)]);
        for (const seed of batch) if (!returnedIds.has(seed.id)) {
          parsed.invalid.push({ id: seed.id, reason: 'Bản chi tiết thiếu ý tưởng cho seed đã chọn.' });
        }
      }
      return parsed;
    };
    const initialRaw = await ask({ stage: 'expand', packet: input.packet, backend: input.backend, context: input.context, selectedSeedsJson: batchSeedsJson, expansionHint });
    if (initialRaw === undefined || await input.context.isCancelled()) return undefined;
    const first = parseExpanded(initialRaw);
    let batchRows = first.valid;
    let batchInvalid = first.invalid;
    let batchRepairCalls = 0;
    let batchRepairRescues = 0;
    const repairable = batchInvalid.filter((row) => mechanicalExpansionRepair(row.reason));
    if (repairable.length >= 2 && now() - startedAt < budgetMs) {
      expansionRepairCalls += 1;
      batchRepairCalls = 1;
      await input.context.appendLog(`${STEP_NAMES.expand}: ${repairable.length} mục có lỗi định dạng hoặc đối chiếu claim; thử sửa một lần cho batch ${batchIndex}.`);
      const repairedRaw = await ask({
        stage: 'expand', packet: input.packet, backend: input.backend, context: input.context, selectedSeedsJson: batchSeedsJson, expansionHint,
        repair: { invalidItems: repairable, originalOutput: first.original },
      });
      if (repairedRaw === undefined || await input.context.isCancelled()) return undefined;
      const repaired = parseExpanded(repairedRaw, false);
      const repairableIds = new Set(repairable.map((row) => row.id));
      const repairedRows = repaired.valid.filter((row) => repairableIds.has(row.id));
      batchRows = mergeRows(first.valid, repairedRows, (row) => row.id);
      const repairedIds = new Set(repairedRows.map((row) => row.id));
      const rescuedIds = new Set(repairable.filter((row) => repairedIds.has(row.id)).map((row) => row.id));
      repairRescues += rescuedIds.size;
      batchRepairRescues = rescuedIds.size;
      const stillInvalid = batchInvalid.filter((row) => !repairedIds.has(row.id));
      const newlyInvalid = repaired.invalid.filter((row) => repairableIds.has(row.id) && !batchInvalid.some((old) => old.id === row.id));
      batchInvalid = [...stillInvalid, ...newlyInvalid];
    }
    for (const invalid of batchInvalid) drop(invalid.id, invalid.reason);
    for (const row of batchRows) {
      if (!expected.has(row.id)) { drop(row.id, 'Bản chi tiết trả về seed ngoài batch.'); continue; }
      expandedById.set(row.id, row);
    }
    for (const seed of batch) if (!expandedById.has(seed.id) && !batchInvalid.some((row) => row.id === seed.id)) {
      drop(seed.id, 'Không nhận được bản chi tiết hợp lệ cho episode đã chọn.');
    }
    const batchAcceptedIds = new Set(batchRows.filter((row) => expected.has(row.id)).map((row) => row.id));
    expandedCount += batchAcceptedIds.size;
    const batchDurationMs = Math.max(0, now() - batchStarted);
    expansionBatches.push({ index: batchIndex, seedCount: batch.length, validCount: batchAcceptedIds.size, durationMs: batchDurationMs, repairCalls: batchRepairCalls, repairRescues: batchRepairRescues });
    offset += batch.length;
  }
  const expandMs = now() - expandStarted;
  const final = trimYoutubeIdeaV2Final([...expandedById.values()], input.request.count, steering);
  dropped.push(...final.dropped);
  const compactDropped = uniqueDropped(dropped);
  const durations = { seedsMs, selectMs, expandMs, totalMs: now() - startedAt };
  const status = final.ideas.length < input.request.count ? 'partial' as const : 'complete' as const;
  const repairCalls = { seeds: generated.repairCalls, select: selectedResponse.repairCalls, expand: expansionRepairCalls };
  const diagnostics: YoutubeIdeaPipelineResult['diagnostics'] = {
    seedCount: distinctSeeds.length, shortlistedCount: selected.seeds.length, expandedCount, validCount: final.ideas.length,
    expansionBatches, repairRescues, budgetStopped, repairCalls,
  };
  const reasonSummary = topDropReasons(compactDropped);
  const dropReasonCounts = Object.fromEntries(compactDropped.reduce((counts, row) => counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1), new Map<string, number>()));
  await input.context.reportProgress(95, { step: final.ideas.length ? 'Đã hoàn tất chọn lọc' : 'Không có ý qua kiểm tra', accepted: final.ideas.length, dropped: compactDropped.length, dropReasonCounts, droppedRows: compactDropped, durations, diagnostics, status });
  if (!final.ideas.length) {
    const reasonsText = reasonSummary.map(({ reason, count }) => `${reason} (${count})`).join('; ') || 'không có ứng viên hợp lệ';
    await input.context.appendLog(`Không có ý tưởng nào qua kiểm tra. Lý do chính: ${reasonsText}.`);
    throw new AppError(`Không có ý tưởng nào đủ căn cứ để lưu. Lý do chính: ${reasonsText}.`, 422, 'YOUTUBE_IDEAS_UNGROUNDED');
  }
  if (await input.context.isCancelled()) return undefined;
  await input.context.appendLog(`Hoàn tất: giữ ${final.ideas.length}/${input.request.count} ý tưởng${status === 'partial' ? ' (kết quả một phần)' : ''}, bỏ ${compactDropped.length}; sơ bộ ${seedsMs} ms, chọn lọc ${selectMs} ms, chi tiết ${expandMs} ms.`);
  return { ideas: final.ideas, dropped: compactDropped, status, diagnostics, durations, repairCalls, promptVersion: 'video-ideas-v2' };
}

export const YOUTUBE_IDEA_STAGE_PROMPTS = YOUTUBE_IDEA_V2_PROMPT_VERSIONS;
