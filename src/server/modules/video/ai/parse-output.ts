import { PopupAiOutputSchema, type PopupAiOutput } from './output-schema';

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
    throw new Error(`Popup AI JSON parse failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return PopupAiOutputSchema.parse(value);
}
