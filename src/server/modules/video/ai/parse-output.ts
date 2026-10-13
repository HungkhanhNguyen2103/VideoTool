import { PopupAiOutputSchema, type PopupAiOutput } from './output-schema';

export type PopupAiOutputErrorKind = 'json' | 'schema';

export class PopupAiOutputError extends Error {
  constructor(readonly kind: PopupAiOutputErrorKind, message: string) {
    super(message);
    this.name = 'PopupAiOutputError';
  }
}

function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text);
  if (fenced?.[1]) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Popup AI output is not valid JSON.');
  return text.slice(start, end + 1);
}

export function parsePopupAiOutput(text: string): PopupAiOutput {
  let value: unknown;
  try {
    value = JSON.parse(extractJson(text));
  } catch (error) {
    throw new PopupAiOutputError('json', `Popup AI JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return PopupAiOutputSchema.parse(value);
  } catch (error) {
    throw new PopupAiOutputError('schema', `Popup AI schema validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Parse a chunk response and require exactly the chunk's primary scene set. */
export function parsePopupAiOutputForScenes(text: string, expectedSceneNumbers: readonly number[]): PopupAiOutput {
  const parsed = parsePopupAiOutput(text);
  const expected = new Set(expectedSceneNumbers);
  const actual = parsed.scenes.map((scene) => scene.scene);
  if (actual.length !== expected.size || new Set(actual).size !== actual.length || actual.some((scene) => !expected.has(scene))) {
    throw new PopupAiOutputError('schema', `Popup AI scene verdicts must exactly match requested scenes: expected ${[...expected].join(', ')}, received ${actual.join(', ')}.`);
  }
  return parsed;
}
