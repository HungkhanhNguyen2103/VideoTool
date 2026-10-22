import { useCallback, useEffect, useRef, useState } from 'react';
import { isTrustedYoutubeOauthMessage } from './youtube-view';

export type YoutubeOauthFinishedMessage = {
  type: 'youtube-oauth-finished';
  success: boolean;
  imported?: number;
  skipped?: number;
  alreadyBound?: number;
  failed?: number;
  profileIds?: string[];
};

type StartRequest = () => Promise<{ authorizationUrl: string }>;

export function useYoutubeOauthPopup(onFinished: (message: YoutubeOauthFinishedMessage) => void) {
  const popupRef = useRef<Window | null>(null);
  const popupMonitorRef = useRef<number | null>(null);
  const onFinishedRef = useRef(onFinished);
  const [pending, setPending] = useState(false);
  onFinishedRef.current = onFinished;

  const stopTracking = useCallback(() => {
    if (popupMonitorRef.current !== null) window.clearInterval(popupMonitorRef.current);
    popupMonitorRef.current = null;
    popupRef.current = null;
    setPending(false);
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isTrustedYoutubeOauthMessage(event, popupRef.current) || !event.data || typeof event.data !== 'object') return;
      const value = event.data as Record<string, unknown>;
      if (value.type !== 'youtube-oauth-finished' || typeof value.success !== 'boolean') return;
      const message: YoutubeOauthFinishedMessage = {
        type: 'youtube-oauth-finished',
        success: value.success,
        ...(typeof value.imported === 'number' ? { imported: value.imported } : {}),
        ...(typeof value.skipped === 'number' ? { skipped: value.skipped } : {}),
        ...(typeof value.alreadyBound === 'number' ? { alreadyBound: value.alreadyBound } : {}),
        ...(typeof value.failed === 'number' ? { failed: value.failed } : {}),
        ...(Array.isArray(value.profileIds) && value.profileIds.every((item) => typeof item === 'string') ? { profileIds: value.profileIds as string[] } : {}),
      };
      stopTracking();
      onFinishedRef.current(message);
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (popupMonitorRef.current !== null) window.clearInterval(popupMonitorRef.current);
    };
  }, [stopTracking]);

  const openPopup = useCallback(async (startRequest: StartRequest) => {
    const popup = window.open('about:blank', 'youtube-oauth', 'popup,width=620,height=760');
    if (!popup) throw new Error('Trình duyệt đã chặn cửa sổ Google. Hãy cho phép popup rồi thử lại.');
    popupRef.current = popup;
    setPending(true);
    popupMonitorRef.current = window.setInterval(() => {
      if (popup.closed) {
        if (popupMonitorRef.current !== null) window.clearInterval(popupMonitorRef.current);
        popupMonitorRef.current = null;
        setPending(false);
      }
    }, 500);
    try {
      const { authorizationUrl } = await startRequest();
      if (!popup.closed) popup.location.href = authorizationUrl;
    } catch (error) {
      popup.close();
      stopTracking();
      throw error;
    }
  }, [stopTracking]);

  return { pending, openPopup };
}
