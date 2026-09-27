import AdmZip from 'adm-zip';
import { ProjectImportSeedSchema, type ProjectImportSeed } from '../../../contracts/project';
import { extractReferenceText, isReferenceDocument } from './reference-text';

function projectJson(zip: AdmZip): ProjectImportSeed {
  const entry = zip.getEntry('project.json');
  if (!entry) throw new Error('ZIP must contain project.json at the root.');
  let raw: unknown;
  try { raw = JSON.parse(entry.getData().toString('utf8')); } catch { throw new Error('project.json is invalid JSON.'); }
  const parsed = ProjectImportSeedSchema.safeParse(raw);
  if (!parsed.success) throw new Error('project.json has invalid project fields.');
  return parsed.data;
}

export function parseProjectImportSeed(buffer: Buffer): ProjectImportSeed {
  let zip: AdmZip;
  try { zip = new AdmZip(buffer); } catch { throw new Error('ZIP file is invalid.'); }
  const seed = projectJson(zip);
  const documents = zip.getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.startsWith('references/'))
    .filter((entry) => isReferenceDocument(entry.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));
  const extracted = documents
    .map((entry) => extractReferenceText(entry.entryName, '', entry.getData()).trim())
    .filter(Boolean);
  if (extracted.length === 0) return seed;
  const referencesText = [seed.referencesText?.trim(), ...extracted].filter(Boolean).join('\n\n');
  return { ...seed, referencesText };
}
