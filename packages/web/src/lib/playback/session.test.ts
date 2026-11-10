import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();
vi.mock('../paths', () => ({
  goBack: vi.fn(),
  goBackInApp: vi.fn(),
  navigate: (...args: unknown[]) => navigate(...args),
  to: { play: (itemId: string, sourceId: string) => `${itemId}/${sourceId}` },
}));
vi.mock('../hosts', () => ({ currentHost: () => ({}) }));
vi.mock('../hosts/shell/bridge', () => ({ appBridge: () => undefined }));
vi.mock('../settings', () => ({ settings: {} }));
vi.mock('./player-choice', () => ({ chosenPlayer: () => ({ kind: 'web' }) }));

const {
  closePlayback,
  openPlayback,
  playbackNow,
  playOn,
  returnFromAudioSwitch,
} = await import('./session');

const audioSwitch = {
  language: 'fre',
  previous: { sourceId: 'english', startMs: 1000, paused: true },
  original: { sourceId: 'english', language: 'eng' },
};

describe('audio switch handoff', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { hash: '#/play/item' } });
    navigate.mockClear();
  });
  afterEach(() => {
    closePlayback();
    vi.unstubAllGlobals();
  });

  it('carries the switch to the player page it opens', () => {
    playOn({ itemId: 'item', sourceId: 'french', startMs: 1000, audioSwitch });
    expect(navigate).toHaveBeenCalledOnce();
    openPlayback({ itemId: 'item', sourceId: 'french', startMs: 1000 });
    expect(playbackNow()).toMatchObject({ sourceId: 'french', audioSwitch });
  });

  it('drops a switch that playback closed before its page opened', () => {
    playOn({ itemId: 'item', sourceId: 'french', startMs: 1000, audioSwitch });
    closePlayback();
    openPlayback({ itemId: 'item', sourceId: 'french', startMs: 0 });
    expect(playbackNow()?.audioSwitch).toBeUndefined();
  });

  it('does not hand a switch to another version', () => {
    playOn({ itemId: 'item', sourceId: 'french', startMs: 1000, audioSwitch });
    openPlayback({ itemId: 'item', sourceId: 'german', startMs: 0 });
    expect(playbackNow()?.audioSwitch).toBeUndefined();
  });

  it('returns to the previous version where it was left', () => {
    returnFromAudioSwitch('item', undefined, audioSwitch);
    openPlayback({ itemId: 'item', sourceId: 'english', startMs: 1000 });
    expect(playbackNow()).toMatchObject({
      sourceId: 'english',
      startMs: 1000,
      startPaused: true,
    });
    expect(playbackNow()?.audioSwitch).toBeUndefined();
  });
});
