import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashNarration } from '../../../../contracts/name-keywords';
import type { ProjectDetail } from '../../../../contracts/project';
import type { PopupPlan } from '../../../../contracts/popup-analysis';
import { PopupAnalysisCard, type PopupAnalysisCardProps } from './PopupAnalysisCard';

const plan = (overrides: Partial<PopupPlan> = {}): PopupPlan => ({
  narrationHash: hashNarration('Sông Tiền.'), audioFileId: 'voice-1', provider: 'deepseek', model: 'deepseek-chat', backend: 'api', density: 'low', generatedAt: '2026-10-13T00:00:00.000Z', needed: true, reason: 'Địa danh cần nhấn.',
  popups: [{ kind: 'place', anchor: 'Sông Tiền', display: 'Sông Tiền', importance: 4, reason: 'Địa danh chính.', startSec: 0, endSec: 3, status: 'kept', dropReason: null, pinned: false, suppressed: false }], dropped: [],
  ...overrides,
});

const project = {
  id: 'project-1', title: 'Project', scenes: [{ id: 'scene-1', narration: 'Sông Tiền.', popupPlan: plan(), audioFileId: 'voice-1', wordTimings: { audioFileId: 'voice-1', words: [{ text: 'Sông', startSec: 0, endSec: .2 }] } }],
  aiProvider: 'deepseek', aiModel: 'deepseek-chat', popupDensity: 'low', keywordPopupsEnabled: true,
} as unknown as ProjectDetail;

describe('PopupAnalysisCard mounted interactions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows verdict reasons and invokes analysis, density, pin, suppress, and edit callbacks in tab order', async () => {
    const calls: Array<[string, unknown]> = [];
    const view = await mountPopupCard({
      project,
      scenes: project.scenes,
      onAnalyze: async () => { calls.push(['analyze', undefined]); },
      onApiModelChange: async () => undefined,
      onDensityChange: async (density) => { calls.push(['density', density]); },
      onToggleFlags: async (sceneId, anchor, flags) => { calls.push(['flags', { sceneId, anchor, flags }]); },
      onEdit: async (sceneId, popup) => { calls.push(['edit', { sceneId, popup }]); },
    });
    try {
      expect(view.text()).toContain('Địa danh cần nhấn.');
      expect(view.text()).toContain('mức 4/5');
      await view.click('Phân tích popup');
      await view.change('Mật độ popup', 'high');
      await view.click('Ghim');
      await view.click('Tắt');
      await view.editDisplay('Sông Tiền — địa danh');
      expect(calls.map(([name]) => name)).toEqual(['analyze', 'density', 'flags', 'flags', 'edit']);
      expect(view.tabLabels()).toEqual(['Backend popup', 'Mật độ popup', 'Model AI', 'Phân tích popup', 'Ghim', 'Tắt', 'Sửa']);
    } finally {
      await view.unmount();
    }
  });

  it('renders pinned and suppressed state from the fresh plan after a re-analysis refresh', async () => {
    const view = await mountPopupCard({
      project,
      scenes: project.scenes,
      onAnalyze: async () => undefined,
      onApiModelChange: async () => undefined,
      onDensityChange: async () => undefined,
      onToggleFlags: async () => undefined,
      onEdit: async () => undefined,
    });
    try {
      await view.click('Ghim');
      await view.click('Tắt');
      const updatedPlan = plan({ popups: [{ ...plan().popups[0]!, pinned: true, suppressed: true }] });
      const updatedProject = { ...project, scenes: [{ ...project.scenes[0]!, popupPlan: updatedPlan }] } as ProjectDetail;
      await view.rerender(updatedProject);
      expect(view.text()).toContain('Bỏ ghim');
      expect(view.text()).toContain('Bật lại');
    } finally {
      await view.unmount();
    }
  });

  it('does not expose actions for a stale stored plan', async () => {
    const staleProject = { ...project, scenes: [{ ...project.scenes[0]!, popupPlan: plan({ narrationHash: 'stale' }) }] } as ProjectDetail;
    const view = await mountPopupCard({
      project: staleProject,
      scenes: staleProject.scenes,
      onAnalyze: async () => undefined,
      onApiModelChange: async () => undefined,
      onDensityChange: async () => undefined,
      onToggleFlags: async () => undefined,
      onEdit: async () => undefined,
    });
    try {
      expect(view.text()).toContain('Cần phân tích lại');
      expect(view.text()).not.toContain('Ghim');
      expect(view.text()).not.toContain('Sửa');
    } finally {
      await view.unmount();
    }
  });
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
  attributes = new Map<string, string>();
  listeners = new Map<string, FakeListener[]>();
  className = '';
  id = '';
  value = '';
  disabled = false;
  type = '';
  text = '';

  constructor(ownerDocument: FakeDocument, nodeName: string) { this.ownerDocument = ownerDocument; this.nodeName = nodeName.toUpperCase(); this.tagName = this.nodeName; }
  appendChild(child: FakeNode): FakeNode { child.parentNode = this; this.childNodes.push(child); return child; }
  insertBefore(child: FakeNode, before: FakeNode | null): FakeNode { child.parentNode = this; const index = before ? this.childNodes.indexOf(before) : -1; if (index < 0) this.childNodes.push(child); else this.childNodes.splice(index, 0, child); return child; }
  removeChild(child: FakeNode): FakeNode { const index = this.childNodes.indexOf(child); if (index >= 0) this.childNodes.splice(index, 1); child.parentNode = null; return child; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); if (name === 'class') this.className = value; if (name === 'id') this.id = value; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  addEventListener(name: string, listener: FakeListener): void { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
  removeEventListener(name: string, listener: FakeListener): void { this.listeners.set(name, (this.listeners.get(name) ?? []).filter((candidate) => candidate !== listener)); }
  dispatchEvent(event: Record<string, unknown>): boolean { event.target ??= this; for (const listener of this.listeners.get(String(event.type)) ?? []) listener(event); this.parentNode?.dispatchEvent(event); return true; }
  focus(): void { this.ownerDocument.activeElement = this; }
  blur(): void { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  contains(node: FakeNode): boolean { return node === this || this.childNodes.some((child) => child.contains(node)); }
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get options(): FakeNode[] { return this.childNodes.filter((child) => child.nodeName === 'OPTION'); }
  get nextSibling(): FakeNode | null { const siblings = this.parentNode?.childNodes ?? []; const index = siblings.indexOf(this); return index >= 0 ? siblings[index + 1] ?? null : null; }
  get textContent(): string { return this.text + this.childNodes.map((child) => child.textContent).join(''); }
  set textContent(value: string) { this.text = value; this.childNodes = []; }
}

class FakeTextNode extends FakeNode { nodeType = 3; constructor(ownerDocument: FakeDocument, value: string) { super(ownerDocument, '#text'); this.text = value; } }

class FakeDocument extends FakeNode {
  nodeType = 9;
  activeElement: FakeNode;
  documentElement: FakeNode;
  body: FakeNode;
  defaultView: Record<string, unknown>;
  constructor() { super(undefined as unknown as FakeDocument, '#document'); this.ownerDocument = this; this.documentElement = new FakeNode(this, 'html'); this.body = new FakeNode(this, 'body'); this.documentElement.appendChild(this.body); this.appendChild(this.documentElement); this.activeElement = this.body; this.defaultView = {}; }
  createElement(name: string): FakeNode { return new FakeNode(this, name); }
  createElementNS(_namespace: string, name: string): FakeNode { return this.createElement(name); }
  createTextNode(value: string): FakeTextNode { return new FakeTextNode(this, value); }
  createComment(value: string): FakeTextNode { return new FakeTextNode(this, value); }
  getElementById(id: string): FakeNode | null { const visit = (node: FakeNode): FakeNode | null => node.id === id ? node : node.childNodes.reduce<FakeNode | null>((found, child) => found ?? visit(child), null); return visit(this); }
}

function installFakeDom(): { document: FakeDocument; restore: () => void } {
  const document = new FakeDocument();
  const window = { document, HTMLElement: FakeNode, HTMLIFrameElement: FakeNode, addEventListener: () => undefined, removeEventListener: () => undefined, getComputedStyle: () => ({}) };
  document.defaultView = window;
  const previous = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({ document, window, navigator: { userAgent: 'vitest' }, HTMLElement: FakeNode, HTMLSelectElement: FakeNode, HTMLInputElement: FakeNode, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  return { document, restore: () => { for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; } } };
}

function findNodes(root: FakeNode, nodeName: string): FakeNode[] { return root.nodeName === nodeName ? [root] : root.childNodes.flatMap((child) => findNodes(child, nodeName)); }
function reactProps(node: FakeNode): Record<string, (event?: unknown) => unknown> { const key = Object.keys(node).find((candidate) => candidate.startsWith('__reactProps$')); if (!key) throw new Error(`No React props found on ${node.nodeName}`); return (node as unknown as Record<string, Record<string, (event?: unknown) => unknown>>)[key]!; }

async function mountPopupCard(props: PopupAnalysisCardProps): Promise<{
  text: () => string;
  click: (label: string) => Promise<void>;
  change: (label: string, value: string) => Promise<void>;
  editDisplay: (value: string) => Promise<void>;
  tabLabels: () => string[];
  rerender: (nextProject: ProjectDetail) => Promise<void>;
  unmount: () => Promise<void>;
}> {
  const { createRoot } = await import('react-dom/client');
  const dom = installFakeDom();
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  await act(async () => { root.render(createElement(PopupAnalysisCard, props)); });
  const buttonByLabel = (label: string): FakeNode => findNodes(container, 'BUTTON').find((node) => node.textContent === label) ?? (() => { throw new Error(`Button not found: ${label}`); })();
  return {
    text: () => container.textContent,
    click: async (label) => { await act(async () => { reactProps(buttonByLabel(label)).onClick?.({}); }); },
    change: async (label, value) => { const node = findNodes(container, 'SELECT').find((item) => item.attributes.get('aria-label') === label); if (!node) throw new Error(`Select not found: ${label}`); await act(async () => { reactProps(node).onChange?.({ currentTarget: { value } }); }); },
    editDisplay: async (value) => { await act(async () => { reactProps(buttonByLabel('Sửa')).onClick?.({}); }); const input = findNodes(container, 'INPUT').find((item) => item.attributes.get('aria-label') === 'Sửa display popup'); if (!input) throw new Error('Edit input not found'); await act(async () => { reactProps(input).onChange?.({ currentTarget: { value } }); reactProps(buttonByLabel('Lưu')).onClick?.({}); }); },
    tabLabels: () => [...findNodes(container, 'SELECT'), ...findNodes(container, 'BUTTON')].map((node) => node.attributes.get('aria-label') ?? node.textContent).filter((value): value is string => Boolean(value)).filter((value) => ['Backend popup', 'Mật độ popup', 'Model AI', 'Phân tích popup', 'Ghim', 'Tắt', 'Sửa'].includes(value)),
    rerender: async (nextProject) => { await act(async () => { root.render(createElement(PopupAnalysisCard, { ...props, project: nextProject, scenes: nextProject.scenes })); }); },
    unmount: async () => { await act(async () => root.unmount()); dom.restore(); },
  };
}
