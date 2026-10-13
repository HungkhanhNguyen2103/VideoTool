import type { PopupKind } from '../../../contracts/popup-analysis';
import type { TimedWord } from './keywords';

export const POPUP_CENTER_HOLD_SEC = 1.2;
export const POPUP_LOWER_THIRD_HOLD_SEC = 3;
export const POPUP_FADE_SEC = 0.3;
export const POPUP_LOWER_THIRD_MIN_REMAIN_SEC = 1;
export const POPUP_LOWER_THIRD_EARLY_START_SEC = 0.5;

export type PopupRawTiming = { kind: PopupKind; startSec: number; endSec: number };
export type PopupWindowResult =
  | { accepted: true; startSec: number; endSec: number }
  | { accepted: false; reason: string };

function roundSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function isLowerThird(kind: PopupKind): boolean {
  return kind === 'person' || kind === 'place' || kind === 'event';
}

/** Preserve the old overlay hold/fade behavior after AI anchor timing is found. */
export function windowPopupTiming(timing: PopupRawTiming, words: ReadonlyArray<TimedWord>): PopupWindowResult {
  const audioEndSec = words.at(-1)?.endSec ?? timing.endSec;
  const holdSec = isLowerThird(timing.kind) ? POPUP_LOWER_THIRD_HOLD_SEC : POPUP_CENTER_HOLD_SEC;
  const minimumRemainSec = isLowerThird(timing.kind) ? POPUP_LOWER_THIRD_MIN_REMAIN_SEC : POPUP_FADE_SEC;
  const endForStart = (startSec: number): number => Math.min(audioEndSec, roundSeconds(startSec + Math.max(timing.endSec - timing.startSec, holdSec) + POPUP_FADE_SEC));
  let startSec = timing.startSec;
  let endSec = endForStart(startSec);
  if (isLowerThird(timing.kind) && endSec - startSec < minimumRemainSec) {
    startSec = Math.max(0, roundSeconds(startSec - POPUP_LOWER_THIRD_EARLY_START_SEC));
    endSec = endForStart(startSec);
  }
  if (endSec - startSec < minimumRemainSec) return { accepted: false, reason: 'không đủ thời gian hiển thị popup' };
  return { accepted: true, startSec, endSec };
}
