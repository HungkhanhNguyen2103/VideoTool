import type { YoutubeChannelOption } from '../../../contracts/youtube';

const CHANNEL_HANDLE_PATTERN = /^@[\p{L}\p{N}_.-]{3,30}$/u;
const CHANNEL_DESCRIPTION_LIMIT = 1000;

function truncateAtWordBoundary(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const prefix = value.slice(0, limit);
  const boundary = prefix.search(/\s+\S*$/u);
  return (boundary > 0 ? prefix.slice(0, boundary) : boundary === -1 ? '' : prefix).trimEnd();
}

export function mapYoutubeChannelToProfile(option: YoutubeChannelOption): {
  name: string;
  handle?: string;
  description: string;
  language: 'vi' | 'en';
} {
  const customUrl = option.customUrl ?? '';
  const language = option.defaultLanguage?.toLowerCase().startsWith('en') ? 'en' : 'vi';
  const handle = CHANNEL_HANDLE_PATTERN.test(customUrl) ? customUrl : undefined;
  return {
    name: option.title.trim().slice(0, 100),
    ...(handle ? { handle } : {}),
    description: truncateAtWordBoundary((option.description ?? '').trim(), CHANNEL_DESCRIPTION_LIMIT),
    language,
  };
}
