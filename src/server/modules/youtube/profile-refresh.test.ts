import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createChannel, getChannel } from '../channel';
import { applyYoutubeProfileOption } from './profile-refresh';

beforeAll(async () => startTestMongo());
beforeEach(async () => getCollection('channels').deleteMany({}));
afterAll(async () => closeTestMongo());

describe('YouTube profile refresh', () => {
  it('fills empty and default fields while preserving existing values and protected fields', async () => {
    const profile = await createChannel({
      name: 'Tên đã nhập', handle: '@kenhcu', description: '', language: 'vi',
      tagline: 'Tagline riêng', links: [{ label: 'Trang', url: 'https://example.com' }],
      defaultHashtags: ['#Rieng'], descriptionFooter: 'Chân trang', aiDisclosureText: 'Công bố',
      thumbnailTemplate: 'Mẫu thumbnail', publishSchedule: null,
    });
    const result = await applyYoutubeProfileOption(profile.id, {
      youtubeChannelId: 'UC-1', title: 'Tên mới', customUrl: '@kenhmoi', description: 'Mô tả mới', defaultLanguage: 'en-US',
    });

    expect(result).toEqual({ updated: ['description', 'language'], skipped: ['name', 'handle'] });
    expect(await getChannel(profile.id)).toMatchObject({
      name: 'Tên đã nhập', handle: '@kenhcu', description: 'Mô tả mới', language: 'en',
      tagline: 'Tagline riêng', links: [{ label: 'Trang', url: 'https://example.com' }],
      defaultHashtags: ['#Rieng'], descriptionFooter: 'Chân trang', aiDisclosureText: 'Công bố',
      thumbnailTemplate: 'Mẫu thumbnail', publishSchedule: null,
    });
  });

  it('overwrites only the explicitly selected fields', async () => {
    const profile = await createChannel({ name: 'Tên cũ', handle: '@kenhcu', description: 'Mô tả cũ', language: 'vi' });
    const result = await applyYoutubeProfileOption(profile.id, {
      youtubeChannelId: 'UC-2', title: 'Tên mới', customUrl: '@kenhmoi', description: 'Mô tả mới', defaultLanguage: 'en-US',
    }, { overwrite: true, fields: ['name', 'description'] });

    expect(result).toEqual({ updated: ['name', 'description'], skipped: ['handle', 'language'] });
    expect(await getChannel(profile.id)).toMatchObject({ name: 'Tên mới', handle: '@kenhcu', description: 'Mô tả mới', language: 'vi' });
  });
});
