import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createProject, duplicateProject, getProject, listProjects, setProjectChannel } from './index';
import { ProjectDocSchema, type ProjectDoc } from './docs';
import { countProjectsByChannelId } from './index';

const projectInput = {
  title: 'Channel project',
  brief: 'A sufficiently long brief for channel tests.',
  language: 'vi' as const,
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: 1,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

beforeAll(async () => {
  await startTestMongo();
});

beforeEach(async () => {
  await getCollection('projects').deleteMany({});
});

afterAll(async () => {
  await closeTestMongo();
});

describe('project channel ownership', () => {
  it('defaults legacy documents to null in detail and summary mappers', async () => {
    const current = await createProject(projectInput);
    const raw = await getCollection<ProjectDoc>('projects').findOne({ _id: current.id });
    expect(raw).not.toBeNull();
    const legacy = { ...raw! } as Record<string, unknown>;
    delete legacy.channelId;
    await getCollection<ProjectDoc>('projects').replaceOne({ _id: current.id }, legacy as ProjectDoc);

    expect((await getProject(current.id)).channelId).toBeNull();
    expect((await listProjects({})).find((project) => project.id === current.id)?.channelId).toBeNull();
    expect(ProjectDocSchema.parse(legacy).channelId).toBeNull();
  });

  it('assigns and clears a channel with one version increment and counts references', async () => {
    const project = await createProject({ ...projectInput, channelId: 'channel-1' });
    expect(await countProjectsByChannelId('channel-1')).toBe(1);

    const assigned = await setProjectChannel(project.id, 'channel-2');
    expect(assigned).toMatchObject({ channelId: 'channel-2', version: project.version + 1 });
    expect(await countProjectsByChannelId('channel-1')).toBe(0);
    expect(await countProjectsByChannelId('channel-2')).toBe(1);

    const cleared = await setProjectChannel(project.id, null);
    expect(cleared).toMatchObject({ channelId: null, version: assigned.version + 1 });
  });

  it('keeps the assigned channel when duplicating a project', async () => {
    const project = await createProject({ ...projectInput, channelId: 'channel-1' });
    const duplicate = await duplicateProject(project.id);
    expect(duplicate.channelId).toBe('channel-1');
    expect(await countProjectsByChannelId('channel-1')).toBe(2);
  });
});
