import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// localStorage em memória: as escolhas ficam guardadas como na TV
const store: Record<string, string> = {};
vi.stubGlobal('navigator', { languages: ['pt-BR'], language: 'pt-BR' });
vi.stubGlobal('window', {
  localStorage: {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => (store[k] = v),
    removeItem: (k: string) => delete store[k],
  },
});

const { audioFor, forgetMovieChoices, movieChoiceLives, rememberAudio, rememberTitleSubtitle, subtitleFor } =
  await import('./audioMemory');
const { saveProgress } = await import('../data/storage');

const movie = { id: 'tt1375666', type: 'movie' as const, title: 'A Origem', genres: [], synopsis: '' };
const series = { id: 'tt0903747', type: 'series' as const, title: 'Breaking Bad', genres: [], synopsis: '' };

describe('movieChoiceLives', () => {
  const now = 1_000_000_000;
  const progress = (time: number, updatedAt: number) => ({
    title: { id: 'x', type: 'movie' as const, title: 'x' },
    time,
    duration: 1000,
    updatedAt,
  });

  it('vale enquanto o filme está em andamento', () => {
    expect(movieChoiceLives(progress(300, now - 1000), now - 5000, now)).toBe(true);
  });

  it('visto até o fim, a escolha de antes não vale', () => {
    expect(movieChoiceLives(progress(990, now - 1000), now - 5000, now)).toBe(false);
  });

  it('visto até o fim, a escolha feita depois (revendo) vale', () => {
    expect(movieChoiceLives(progress(990, now - 5000), now - 1000, now)).toBe(true);
  });

  it('sem progresso, só a escolha recém-feita vale', () => {
    expect(movieChoiceLives(undefined, now - 60 * 1000, now)).toBe(true);
    expect(movieChoiceLives(undefined, now - 2 * 60 * 60 * 1000, now)).toBe(false);
  });
});

describe('escolhas por título', () => {
  // Configurações: áudio em português
  // cada passo um segundo depois do outro, como no uso de verdade
  let clock = 1_800_000_000_000;
  const later = () => vi.setSystemTime((clock += 1000));
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    store['freeflix.settings'] = JSON.stringify({ audio: 'pt' });
    vi.useFakeTimers();
    later();
  });
  afterEach(() => vi.useRealTimers());

  it('filme em andamento lembra áudio e legenda; terminado volta ao de Configurações', () => {
    saveProgress(movie, { time: 300, duration: 9000 });
    rememberAudio(movie, 'original');
    rememberTitleSubtitle(movie, { language: 'pt', videoId: movie.id, url: 'u1', offset: 1.5 });
    expect(audioFor(movie)).toBe('original');
    expect(subtitleFor(movie)).toEqual({ language: 'pt', videoId: movie.id, url: 'u1', offset: 1.5 });
    later();
    saveProgress(movie, { time: 8990, duration: 9000 });
    expect(audioFor(movie)).toBe('pt');
    expect(subtitleFor(movie)).toBeUndefined();
  });

  it('recomeçado do início, o filme esquece as escolhas', () => {
    saveProgress(movie, { time: 300, duration: 9000 });
    rememberAudio(movie, 'original');
    forgetMovieChoices(movie);
    expect(audioFor(movie)).toBe('pt');
  });

  it('a escolha nova depois do fim não traz de volta a legenda antiga', () => {
    saveProgress(movie, { time: 300, duration: 9000 });
    rememberTitleSubtitle(movie, { language: 'en' });
    later();
    saveProgress(movie, { time: 8990, duration: 9000 });
    later();
    rememberAudio(movie, 'original');
    expect(audioFor(movie)).toBe('original');
    expect(subtitleFor(movie)).toBeUndefined();
  });

  it('série lembra áudio e legenda para os próximos episódios', () => {
    rememberAudio(series, 'en');
    rememberTitleSubtitle(series, { language: 'pt', videoId: 'tt0903747:1:1' });
    expect(audioFor(series)).toBe('en');
    expect(subtitleFor(series)).toEqual({ language: 'pt', videoId: 'tt0903747:1:1' });
  });
});
