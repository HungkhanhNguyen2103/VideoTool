export type PublishSlotClipboardWriter = (text: string) => Promise<void> | void;
export type PublishSlotCopyResult = { copied: boolean; fallbackText: string | null };

export async function copyPublishSlot(text: string, writeText: PublishSlotClipboardWriter): Promise<PublishSlotCopyResult> {
  try {
    await writeText(text);
    return { copied: true, fallbackText: null };
  } catch {
    return { copied: false, fallbackText: text };
  }
}
