import { describe, expect, it } from 'vitest';
import { readinessBadgeForStatus } from './scene-readiness-ui';

describe('scene readiness UI', () => {
  it('maps readiness statuses to one user-facing badge tone and label', () => {
    expect(readinessBadgeForStatus('missing-asset')).toEqual({ label: 'Thiếu asset', tone: 'red' });
    expect(readinessBadgeForStatus('missing-clip')).toEqual({ label: 'Thiếu clip', tone: 'red' });
    expect(readinessBadgeForStatus('keyframe-only')).toEqual({ label: 'Chỉ có keyframe', tone: 'amber' });
    expect(readinessBadgeForStatus('clip-unmeasured')).toEqual({ label: 'Chưa đo clip', tone: 'muted' });
    expect(readinessBadgeForStatus('clip-cut')).toEqual({ label: 'Clip bị cắt', tone: 'amber' });
    expect(readinessBadgeForStatus('clip-padded')).toEqual({ label: 'Clip được đệm', tone: 'amber' });
    expect(readinessBadgeForStatus('no-tail')).toEqual({ label: 'Thiếu khung cuối', tone: 'muted' });
    expect(readinessBadgeForStatus('ok')).toBeNull();
  });
});
