import { describe, expect, it } from 'vitest';
import type { YoutubeChannelOption } from '../../../contracts/youtube';
import { mapYoutubeChannelToProfile } from './youtube-profile-mapper';

const option = (overrides: Partial<YoutubeChannelOption> = {}): YoutubeChannelOption => ({
  youtubeChannelId: 'youtube-1',
  title: '  Kênh Việt  ',
  customUrl: '@kenhviet',
  description: 'Mô tả kênh',
  defaultLanguage: 'vi-VN',
  ...overrides,
});

describe('mapYoutubeChannelToProfile', () => {
  it('trims title and description, accepts contract handles, and maps Vietnamese language', () => {
    expect(mapYoutubeChannelToProfile(option())).toEqual({
      name: 'Kênh Việt',
      handle: '@kenhviet',
      description: 'Mô tả kênh',
      language: 'vi',
    });
  });

  it('drops an invalid custom URL and uses English when the default language starts with en', () => {
    expect(mapYoutubeChannelToProfile(option({ customUrl: '@ab', defaultLanguage: 'en-GB' }))).toEqual({
      name: 'Kênh Việt',
      description: 'Mô tả kênh',
      language: 'en',
    });
  });

  it('truncates a long description at a word boundary without an ellipsis', () => {
    const description = `${'Từ '.repeat(400)}cuối cùng`;
    const mapped = mapYoutubeChannelToProfile(option({ description }));
    expect(mapped.description).toHaveLength(998);
    expect(mapped.description.endsWith(' ')).toBe(false);
    expect(mapped.description.endsWith('Từ')).toBe(true);
  });

  it('does not cut through a single word when no boundary fits the limit', () => {
    expect(mapYoutubeChannelToProfile(option({ description: 'x'.repeat(1_200) })).description).toBe('');
  });

  it('defaults unsupported languages to Vietnamese and preserves an empty trimmed title', () => {
    expect(mapYoutubeChannelToProfile(option({ title: '  ', defaultLanguage: 'fr-FR' }))).toEqual({
      name: '',
      handle: '@kenhviet',
      description: 'Mô tả kênh',
      language: 'vi',
    });
  });

  it('limits a trimmed title to the channel name contract maximum', () => {
    expect(mapYoutubeChannelToProfile(option({ title: ` ${'K'.repeat(120)} ` })).name).toHaveLength(100);
  });
});
