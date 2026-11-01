import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('navigator', { languages: ['pt-BR'], language: 'pt-BR', userAgent: '' });
vi.stubGlobal('window', {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (id: number) => clearTimeout(id),
  localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  location: { protocol: 'http:' },
});

const { firstToOpen } = await import('./torrent');

/** torrent de mentira: abre em `ms` ou nunca (morto: falha em 12 s, como o tempo limite do app) */
function fake(ms: number | 'dead') {
  return () =>
    new Promise<string>((resolve, reject) =>
      ms === 'dead' ? setTimeout(() => reject(new Error('timeout')), 12000) : setTimeout(() => resolve('url'), ms),
    );
}

describe('firstToOpen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function race(timings: (number | 'dead')[], parallel = true) {
    const started: number[] = [];
    const dropped: number[] = [];
    const items = timings.map((_, i) => i);
    const at = Date.now();
    let finished = -1;
    const result = firstToOpen(
      items,
      (i) => {
        started.push(i);
        return fake(timings[i])();
      },
      { hedgeMs: 4000, parallel: () => parallel, drop: (i) => dropped.push(i) },
    ).then((r) => {
      finished = Date.now() - at;
      return r;
    });
    await vi.runAllTimersAsync();
    return { winner: (await result)?.item ?? null, finished, started, dropped };
  }

  it('o primeiro com peers abre sozinho, sem companhia', async () => {
    const r = await race([1500, 1000, 1000]);
    expect(r).toMatchObject({ winner: 0, finished: 1500, started: [0] });
  });

  it('primeiro morto: o seguinte entra em 4 s, não em 12', async () => {
    const r = await race(['dead', 1500, 1000]);
    expect(r.winner).toBe(1);
    expect(r.finished).toBe(5500);
    // o morto sai do motor
    expect(r.dropped).toContain(0);
  });

  it('primeiro lento mas vivo: fica o que abrir primeiro, o outro sai', async () => {
    const r = await race([6000, 3000, 1000]);
    expect(r.winner).toBe(0);
    expect(r.finished).toBe(6000);
    expect(r.started).toEqual([0, 1]);
    expect(r.dropped).toContain(1);
  });

  it('com torrent em uso, um por vez, como antes', async () => {
    const r = await race(['dead', 1500], false);
    expect(r.winner).toBe(1);
    expect(r.finished).toBe(13500);
  });

  it('nenhum abre: null', async () => {
    const r = await race(['dead', 'dead', 'dead']);
    expect(r.winner).toBeNull();
    expect(r.dropped.sort()).toEqual([0, 1, 2]);
  });
});

describe('torrent de outro título', () => {
  it('fica de fora pelo nome do arquivo', async () => {
    const { otherTitle } = await import('./parse');
    const names = ['Resident Evil', 'Resident Evil', ''];
    expect(otherTitle('the.shadow.men.1997.1080p.web.hevc.x265.rmteam.mkv', '', names)).toBe(true);
    expect(otherTitle('Resident Evil 2026.1080p.WEB-DL.AAC.x264-rothebehap.mp4', '', names)).toBe(false);
  });
});
