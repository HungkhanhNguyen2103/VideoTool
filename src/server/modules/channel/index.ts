// Public API of the channel module. Nothing else in this module may be imported from outside.
export { assertChannelExists, createChannel, deleteChannel, getChannel, listChannels, updateChannel } from './service';
export { createChannelRouter } from './routes';
export { ensureChannelIndexes } from './indexes';
export { ChannelDocSchema } from './docs';
export type { ChannelDoc } from './docs';
