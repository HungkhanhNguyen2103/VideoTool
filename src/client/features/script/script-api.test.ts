import { describe, expect, it } from 'vitest';
import { parseSseFrames } from './api';

describe('script SSE parser', () => {
  it('buffers incomplete frames and returns complete events in order', () => {
    const first = parseSseFrames('event: chunk\ndata: "one"\n\nevent: done\ndata: {"id":"c1"}\n\npartial');
    expect(first.frames).toEqual([
      { event: 'chunk', data: '"one"' },
      { event: 'done', data: '{"id":"c1"}' },
    ]);
    expect(first.remainder).toBe('partial');
  });

  it('ignores heartbeat comments and parses default message events', () => {
    const result = parseSseFrames(': heartbeat\n\ndata: {"status":"running"}\n\n');
    expect(result.frames).toEqual([{ event: 'message', data: '{"status":"running"}' }]);
  });
});
