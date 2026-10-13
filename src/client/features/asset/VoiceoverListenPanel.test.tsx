import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scene } from '../../../contracts/project';
import { hashNarration } from '../../../contracts/name-keywords';
import { VoiceoverListenPanel } from './VoiceoverListenPanel';
import { audioUrlWithCacheBust, resetVoiceoverAudio, syncVoiceoverAudio, type VoiceoverAudioPort } from './voiceover-listen';

const scene = (id: string, narration: string, audioFileId: string | null, speed = 1): Scene => ({
  id,
  narration,
  visualPrompt: '',
  durationSec: 2,
  active: true,
  assetType: 'image',
  assetFileId: null,
  audioFileId,
  voiceoverDurationSec: audioFileId ? 1.8 : null,
  voiceoverInput: audioFileId ? { voice: 'vi-female', speed, narrationHash: hashNarration(narration) } : null,
  wordTimings: null,
  sfxPrompt: '',
  motionPrompt: '',
  sfxFileId: null,
  videoKeyframeFileId: null,
  videoTailFileId: null,
  videoDurationSec: null,
  depthMap: null,
  nameCandidates: null,
});

type FakeListener = (event: Record<string, unknown>) => void;

class FakeNode {
  nodeType = 1;
  nodeName: string;
  tagName: string;
  namespaceURI = 'http://www.w3.org/1999/xhtml';
  ownerDocument: FakeDocument;
  parentNode: FakeNode | null = null;
  childNodes: FakeNode[] = [];
  style: Record<string, string> = {};
  attributes = new Map<string, string>();
  listeners = new Map<string, FakeListener[]>();
  className = '';
  id = '';
  value = '';
  checked = false;
  disabled = false;
  type = '';
  text = '';

  constructor(ownerDocument: FakeDocument, nodeName: string) {
    this.ownerDocument = ownerDocument;
    this.nodeName = nodeName.toUpperCase();
    this.tagName = this.nodeName;
  }

  appendChild(child: FakeNode): FakeNode {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child: FakeNode, before: FakeNode | null): FakeNode {
    child.parentNode = this;
    const index = before ? this.childNodes.indexOf(before) : -1;
    if (index < 0) this.childNodes.push(child);
    else this.childNodes.splice(index, 0, child);
    return child;
  }

  removeChild(child: FakeNode): FakeNode {
    const index = this.childNodes.indexOf(child);
    if (index >= 0) this.childNodes.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
    if (name === 'id') this.id = value;
  }

  removeAttribute(name: string): void { this.attributes.delete(name); }
  addEventListener(name: string, listener: FakeListener): void { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
  removeEventListener(name: string, listener: FakeListener): void { this.listeners.set(name, (this.listeners.get(name) ?? []).filter((candidate) => candidate !== listener)); }
  dispatchEvent(event: Record<string, unknown>): boolean {
    event.target ??= this;
    for (const listener of this.listeners.get(String(event.type)) ?? []) listener(event);
    this.parentNode?.dispatchEvent(event);
    return true;
  }
  focus(): void { this.ownerDocument.activeElement = this; }
  blur(): void { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  scrollIntoView(): void { /* no layout in the node test DOM */ }
  contains(node: FakeNode): boolean { return node === this || this.childNodes.some((child) => child.contains(node)); }
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get nextSibling(): FakeNode | null { const siblings = this.parentNode?.childNodes ?? []; const index = siblings.indexOf(this); return index >= 0 ? siblings[index + 1] ?? null : null; }
  get textContent(): string { return this.text + this.childNodes.map((child) => child.textContent).join(''); }
  set textContent(value: string) { this.text = value; this.childNodes = []; }
}

class FakeAudio extends FakeNode {
  currentTime = 0;
  paused = true;
  currentSrc = '';
  src = '';
  playCalls = 0;
  pauseCalls = 0;
  loadCalls = 0;

  constructor(ownerDocument: FakeDocument) { super(ownerDocument, 'audio'); }
  play(): Promise<void> { this.playCalls += 1; this.paused = false; this.currentSrc = this.src; return Promise.resolve(); }
  pause(): void { this.pauseCalls += 1; this.paused = true; }
  load(): void { this.loadCalls += 1; this.currentSrc = this.src; }
}

class FakeTextNode extends FakeNode {
  nodeType = 3;
  constructor(ownerDocument: FakeDocument, value: string) { super(ownerDocument, '#text'); this.text = value; }
}

class FakeDocument extends FakeNode {
  nodeType = 9;
  activeElement: FakeNode;
  documentElement: FakeNode;
  body: FakeNode;
  defaultView: Record<string, unknown>;

  constructor() {
    super(undefined as unknown as FakeDocument, '#document');
    this.ownerDocument = this;
    this.documentElement = new FakeNode(this, 'html');
    this.body = new FakeNode(this, 'body');
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
    this.defaultView = {};
  }

  createElement(name: string): FakeNode { return name === 'audio' ? new FakeAudio(this) : new FakeNode(this, name); }
  createElementNS(_namespace: string, name: string): FakeNode { return this.createElement(name); }
  createTextNode(value: string): FakeTextNode { return new FakeTextNode(this, value); }
  createComment(value: string): FakeTextNode { return new FakeTextNode(this, value); }
  getElementById(id: string): FakeNode | null {
    const visit = (node: FakeNode): FakeNode | null => node.id === id ? node : node.childNodes.reduce<FakeNode | null>((found, child) => found ?? visit(child), null);
    return visit(this);
  }
}

function installFakeDom(): { document: FakeDocument; restore: () => void } {
  const document = new FakeDocument();
  const window = { document, HTMLIFrameElement: FakeNode, addEventListener: () => undefined, removeEventListener: () => undefined, getComputedStyle: () => ({}) };
  document.defaultView = window;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ document, window, navigator: { userAgent: 'vitest' }, HTMLElement: FakeNode, HTMLAudioElement: FakeAudio, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  return {
    document,
    restore: () => {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete (globalThis as Record<string, unknown>)[name];
      }
    },
  };
}

function findNodes(root: FakeNode, nodeName: string): FakeNode[] {
  return root.nodeName === nodeName ? [root] : root.childNodes.flatMap((child) => findNodes(child, nodeName));
}

type ReactHandler = (event?: unknown) => unknown;

function reactProps(node: FakeNode): Record<string, ReactHandler> {
  const key = Object.keys(node).find((candidate) => candidate.startsWith('__reactProps$'));
  if (!key) throw new Error(`No React props found on ${node.nodeName}`);
  return (node as unknown as Record<string, Record<string, ReactHandler>>)[key]!;
}

async function mountedPanel(options: { scenes?: Scene[]; sceneTailInput?: string } = {}) {
  const { createRoot } = await import('react-dom/client');
  const dom = installFakeDom();
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  const scenes = options.scenes ?? [scene('scene-1', 'First narration', 'voice-1'), scene('scene-2', 'Second narration', 'voice-2'), scene('scene-3', 'Third narration', 'voice-3')];
  const props = {
    scenes,
    project: { id: 'project-1', voiceoverVoice: 'vi-female', voiceSpeed: 1, sceneTailSec: 0.2 },
    sceneTailInput: options.sceneTailInput ?? '0.2',
    audioUrls: Object.fromEntries(scenes.filter((item) => item.audioFileId).map((item) => [item.id, `/files/${item.audioFileId}.wav`])),
    reloadVersions: {},
    onRegenerate: async () => true,
  };
  const root = createRoot(container as unknown as Element);
  await act(async () => { root.render(createElement(VoiceoverListenPanel, props)); });
  return {
    container,
    audio: () => findNodes(container, 'AUDIO')[0]! as FakeAudio,
    rows: () => findNodes(container, 'BUTTON').filter((item) => item.attributes.get('role') === 'listitem'),
    checkbox: () => findNodes(container, 'INPUT')[0]!,
    text: () => container.textContent,
    rerender: async (nextInput: string) => { await act(async () => { root.render(createElement(VoiceoverListenPanel, { ...props, sceneTailInput: nextInput })); }); },
    rerenderScenes: async (nextScenes: Scene[]) => { await act(async () => { root.render(createElement(VoiceoverListenPanel, { ...props, scenes: nextScenes, audioUrls: Object.fromEntries(nextScenes.filter((item) => item.audioFileId).map((item) => [item.id, `/files/${item.audioFileId}.wav`])) })); }); },
    togglePlayback: async () => { await act(async () => { const button = findNodes(container, 'BUTTON').find((item) => item.textContent === 'Phát' || item.textContent === 'Tạm dừng'); if (!button) throw new Error('Playback button not found'); reactProps(button).onClick!({}); }); },
    end: async () => { await act(async () => { reactProps(findNodes(container, 'AUDIO')[0]!).onEnded!({}); }); },
    clickRow: async (index: number) => { await act(async () => { reactProps(findNodes(container, 'BUTTON').filter((item) => item.attributes.get('role') === 'listitem')[index]!).onClick!({}); }); },
    toggleAutoAdvance: async (checked: boolean) => { await act(async () => { reactProps(findNodes(container, 'INPUT')[0]!).onChange!({ currentTarget: { checked } }); }); },
    unmount: async () => { await act(async () => root.unmount()); dom.restore(); },
  };
}

describe('VoiceoverListenPanel integration wiring', () => {
  it('renders the selected audio with the regeneration cache bust and scene statuses', () => {
    const html = renderToStaticMarkup(createElement(VoiceoverListenPanel, {
      scenes: [scene('scene-1', 'First narration', 'voice-1'), scene('scene-2', 'Second narration', 'voice-2', 1.2)],
      project: { id: 'project-1', voiceoverVoice: 'vi-female', voiceSpeed: 1, sceneTailSec: 0.2 },
      sceneTailInput: '0.2',
      audioUrls: { 'scene-1': '/files/voice-1.wav', 'scene-2': '/files/voice-2.wav' },
      reloadVersions: { 'scene-1': 2 },
      onRegenerate: async () => true,
    }));

    expect(html).toContain('src="/files/voice-1.wav?voiceoverVersion=2"');
    expect(html).toContain('First narration');
    expect(html).toContain('green');
    expect(html).toContain('amber');
  });

  it('keeps the paused position while toggling playback and resets only for a regenerated source', async () => {
    const calls: string[] = [];
    const audio: VoiceoverAudioPort = {
      currentTime: 0,
      pause: () => calls.push('pause'),
      load: () => calls.push('load'),
      play: async () => { calls.push('play'); },
    };
    const input = { isPlaying: false, status: 'ready' as const, hasSource: true, onBlocked: () => undefined, onAutoplayRejected: () => undefined };
    audio.currentTime = 0.42;
    await expect(syncVoiceoverAudio(audio, input)).resolves.toBe('idle');
    expect(audio.currentTime).toBe(0.42);
    await expect(syncVoiceoverAudio(audio, { ...input, isPlaying: true })).resolves.toBe('playing');
    expect(calls).toEqual(['pause', 'play']);

    resetVoiceoverAudio(audio, audioUrlWithCacheBust('/files/voice.wav', 2));
    expect(audio.currentTime).toBe(0);
    expect(calls.at(-2)).toBe('pause');
    expect(calls.at(-1)).toBe('load');
  });

  it('auto-pauses missing/stale scenes and exposes rejected autoplay to the component state', async () => {
    const calls: string[] = [];
    const audio: VoiceoverAudioPort = {
      currentTime: 0,
      pause: () => calls.push('pause'),
      load: () => undefined,
      play: async () => { throw new Error('autoplay blocked'); },
    };
    const blocked: string[] = [];
    await expect(syncVoiceoverAudio(audio, { isPlaying: true, status: 'missing', hasSource: false, onBlocked: (status) => blocked.push(status), onAutoplayRejected: () => undefined })).resolves.toBe('blocked');
    await expect(syncVoiceoverAudio(audio, { isPlaying: true, status: 'stale', hasSource: true, onBlocked: (status) => blocked.push(status), onAutoplayRejected: () => undefined })).resolves.toBe('blocked');
    let rejected = false;
    await expect(syncVoiceoverAudio(audio, { isPlaying: true, status: 'ready', hasSource: true, onBlocked: () => undefined, onAutoplayRejected: () => { rejected = true; } })).resolves.toBe('autoplay-error');
    expect(blocked).toEqual(['missing', 'stale']);
    expect(rejected).toBe(true);
    expect(calls).toEqual(['pause', 'pause']);
  });

  it('mounts the gap flow and cancels pending advance when another scene is clicked', async () => {
    vi.useFakeTimers();
    const view = await mountedPanel();
    try {
      await view.togglePlayback();
      await view.end();
      expect(view.text()).toContain('Đang chờ chuyển sang scene tiếp theo');
      expect(view.text()).toContain('Còn 0.20 giây');
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      await view.clickRow(1);
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(1000);
      expect(view.rows()[1]!.attributes.get('aria-current')).toBe('true');
    } finally {
      await view.unmount();
    }
  });

  it('mounts checkbox-off, live-input, final-scene, and blocked-next behavior', async () => {
    vi.useFakeTimers();
    const view = await mountedPanel();
    try {
      await view.togglePlayback();
      await view.end();
      await view.toggleAutoAdvance(false);
      vi.advanceTimersByTime(1000);
      expect(view.rows()[0]!.attributes.get('aria-current')).toBe('true');
      expect(view.text()).not.toContain('Đã nghe hết');
      await view.rerender('1.0');
      await view.toggleAutoAdvance(true);
      await view.togglePlayback();
      await view.end();
      expect(view.text()).toContain('Còn 1.00 giây');
    } finally {
      await view.unmount();
    }

    const finalView = await mountedPanel({ scenes: [scene('last', 'Only narration', 'voice-last')] });
    try {
      await finalView.toggleAutoAdvance(false);
      await finalView.togglePlayback();
      await finalView.end();
      expect(finalView.text()).toContain('Đã nghe hết');
    } finally {
      await finalView.unmount();
    }

    const blockedView = await mountedPanel({ scenes: [scene('ready', 'Ready narration', 'voice-ready'), scene('missing', 'Missing narration', null)] });
    try {
      await blockedView.togglePlayback();
      await blockedView.end();
      expect(blockedView.text()).toContain('chưa có voiceover');
      expect(blockedView.text()).toContain('Tạo lại voice scene này');
    } finally {
      await blockedView.unmount();
    }

    const staleView = await mountedPanel({ scenes: [scene('ready', 'Ready narration', 'voice-ready'), scene('stale', 'Stale narration', 'voice-stale', 1.2)] });
    try {
      await staleView.togglePlayback();
      await staleView.end();
      expect(staleView.text()).toContain('đã cũ');
      expect(staleView.text()).toContain('Tạo lại voice scene này');
    } finally {
      await staleView.unmount();
    }
  });

  it('cancels a mounted gap timer on unmount', async () => {
    vi.useFakeTimers();
    const view = await mountedPanel();
    await view.togglePlayback();
    await view.end();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rechecks the next scene when a pending gap ends', async () => {
    vi.useFakeTimers();
    const view = await mountedPanel();
    try {
      await view.togglePlayback();
      await view.end();
      await view.rerenderScenes([scene('scene-1', 'First narration', 'voice-1'), scene('scene-2', 'Now missing', null), scene('scene-3', 'Third narration', 'voice-3')]);
      await act(async () => { vi.advanceTimersByTime(200); });
      expect(view.rows()[0]!.attributes.get('aria-current')).toBe('true');
      expect(view.text()).toContain('chưa có voiceover');
      expect(view.text()).toContain('Tạo lại voice scene này');
    } finally {
      await view.unmount();
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});
