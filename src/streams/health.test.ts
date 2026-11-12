import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isDown, markDown, markUp, onlyUp, probeSources, showsDown } from './health';

const ok = { ok: true, json: () => Promise.resolve({ id: 'x', name: 'x' }) };

// getJson usa window.setTimeout; no node, window é o próprio global
beforeEach(() => vi.stubGlobal('window', globalThis));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  ['https://a', 'https://b', 'https://c'].forEach(markUp);
});

describe('fontes no ar', () => {
  it('teste ao abrir tira só a fonte que não responde', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.indexOf('https://b/') === 0 ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(ok),
      ),
    );
    await probeSources(['https://a', 'https://b', 'https://c']);
    const list = [{ base: 'https://a' }, { base: 'https://b' }, { base: 'https://c' }];
    expect(onlyUp(list).map((s) => s.base)).toEqual(['https://a', 'https://c']);
  });

  it('erro 500 também tira a fonte; resposta 404 não', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(url.indexOf('https://a/') === 0 ? { ok: false, status: 503 } : { ok: false, status: 404 }),
      ),
    );
    await probeSources(['https://a']);
    expect(isDown('https://a')).toBe(true);
    expect(showsDown(new Error('http 404'))).toBe(false);
    expect(showsDown(new Error('http 502'))).toBe(true);
    expect(showsDown(new Error('timeout'))).toBe(false);
    expect(showsDown(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('todas fora: pergunta a todas', () => {
    markDown('https://a');
    markDown('https://b');
    expect(onlyUp([{ base: 'https://a' }, { base: 'https://b' }])).toHaveLength(2);
  });

  it('passado o tempo, testa de novo e volta se respondeu', async () => {
    vi.useFakeTimers();
    markDown('https://a');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(ok)));
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(isDown('https://a')).toBe(true);
    await vi.runAllTimersAsync();
    expect(isDown('https://a')).toBe(false);
  });
});
