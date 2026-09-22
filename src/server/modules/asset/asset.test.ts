import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileSummarySchema } from '../../../contracts/file';
import { getCollection } from '../../db/client';
import { closeTestMongo, startTestMongo } from '../../../test-utils/mongo';
import { createProject, getProject } from '../project';

const projectInput = {
  title: 'Asset contract project',
  brief: 'A valid brief for asset contract tests.',
  language: 'vi' as const,
  referencesText: '',
  scriptPresetId: 'documentary' as const,
  targetDurationSec: 60,
  chapterCount: 1,
  voiceId: null,
  renderSettings: { aspect: '16:9' as const, width: 1920, height: 1080, fps: 30 as const },
};

beforeAll(() => startTestMongo());
afterAll(() => closeTestMongo());

describe('asset contracts', () => {
  it('defaults asset fields when reading a legacy scene document', async () => {
    const project = await createProject(projectInput);
    await getCollection<{ _id: string }>('projects').updateOne(
      { _id: project.id },
      {
        $set: {
          scenes: [{ id: 'scene-1', narration: 'Opening', visualPrompt: 'A door', durationSec: 5 }],
        },
      },
    );

    const loaded = await getProject(project.id);
    expect(loaded.scenes[0]).toMatchObject({ assetType: 'image', assetFileId: null });
  });

  it('requires the generated stored path in file summaries', () => {
    const summary = FileSummarySchema.parse({
      id: 'file-1',
      projectId: 'project-1',
      originalName: 'scene.png',
      mimeType: 'image/png',
      ext: 'png',
      sizeBytes: 10,
      purpose: 'reference',
      storedPath: 'file-1.png',
      createdAt: new Date().toISOString(),
    });

    expect(summary.storedPath).toBe('file-1.png');
  });
});
