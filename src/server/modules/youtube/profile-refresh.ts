import type { YoutubeChannelOption } from '../../../contracts/youtube';
import type { UpdateChannelRequest } from '../../../contracts/channel';
import { getChannel, updateChannel } from '../channel';
import { mapYoutubeChannelToProfile } from './youtube-profile-mapper';

export const YOUTUBE_PROFILE_FIELDS = ['name', 'handle', 'description', 'language'] as const;
export type YoutubeProfileField = typeof YOUTUBE_PROFILE_FIELDS[number];

export async function applyYoutubeProfileOption(
  profileId: string,
  option: YoutubeChannelOption,
  input: { overwrite?: boolean; fields?: readonly YoutubeProfileField[] } = {},
): Promise<{ updated: YoutubeProfileField[]; skipped: YoutubeProfileField[] }> {
  const current = await getChannel(profileId);
  const mapped = mapYoutubeChannelToProfile(option);
  const patch: UpdateChannelRequest = {};
  const updated: YoutubeProfileField[] = [];

  for (const field of YOUTUBE_PROFILE_FIELDS) {
    const incoming = mapped[field];
    const existing = current[field] ?? '';
    const hasIncomingValue = typeof incoming === 'string' && incoming.trim().length > 0;
    const selected = input.overwrite === true && (input.fields ?? []).includes(field);
    const emptyOrDefault = field === 'language' ? current.language === 'vi' : existing.trim().length === 0;
    const shouldWrite = hasIncomingValue && incoming !== existing && (selected || (input.overwrite !== true && emptyOrDefault));
    if (!shouldWrite) continue;

    if (field === 'name') patch.name = mapped.name;
    else if (field === 'handle' && mapped.handle) patch.handle = mapped.handle;
    else if (field === 'description') patch.description = mapped.description;
    else if (field === 'language') patch.language = mapped.language;
    updated.push(field);
  }

  if (updated.length) await updateChannel(profileId, patch);
  return { updated, skipped: YOUTUBE_PROFILE_FIELDS.filter((field) => !updated.includes(field)) };
}
