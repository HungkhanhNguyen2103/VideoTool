export type TtsOptions = {
  voice?: string;
  speed?: number;
  temperature?: number;
  refAudioPath?: string;
  refAudioText?: string;
};

export interface TtsClient {
  synthesize(text: string, opts?: TtsOptions): Promise<Buffer>;
}
