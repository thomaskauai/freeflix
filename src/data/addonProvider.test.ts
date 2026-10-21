import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('navigator', { languages: ['pt-BR'], language: 'pt-BR' });
vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem: () => undefined } });

const { fillFrom } = await import('./addonProvider');

describe('fillFrom', () => {
  const pt = {
    id: 'tt2152112',
    type: 'series',
    name: 'Quilos Mortais',
    description: '',
    videos: [
      { id: 'a', season: 6, episode: 14, name: 'A História de Robert', runtime: '1h28min', thumbnail: 'pt14' },
      { id: 'b', season: 6, episode: 16, name: 'Episódio 16' },
      { id: 'c', season: 6, episode: 17, name: 'Episódio 17' },
    ],
  };
  const en = {
    id: 'tt2152112',
    type: 'series',
    name: 'My 600-lb Life',
    description: 'Follows people',
    videos: [
      { id: 'a', season: 6, episode: 14, name: "Jennifer & Marissa's Story", runtime: '1h28min', thumbnail: 'en14' },
      { id: 'b', season: 6, episode: 16, name: 'Melissa Morris', runtime: '45min', thumbnail: 'en16' },
      { id: 'c', season: 6, episode: 17, name: 'Episode 17' },
    ],
  };

  it('completa só o que falta no idioma do aparelho', () => {
    const out = fillFrom(pt, en);
    expect(out.description).toBe('Follows people');
    expect(out.videos![0]).toMatchObject({ title: 'A História de Robert', thumbnail: 'pt14' });
    expect(out.videos![1]).toMatchObject({ title: 'Melissa Morris', runtime: '45min', thumbnail: 'en16' });
    // genérico nos dois: fica o traduzido
    expect(out.videos![2].title).toBe('Episódio 17');
  });

  it('sem o outro idioma, nada muda', () => {
    expect(fillFrom(pt, null)).toBe(pt);
  });
});
