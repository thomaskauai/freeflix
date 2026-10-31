// Áudio escolhido no player, por título. Série: vale para os próximos
// episódios, guardado no aparelho. Filme: só enquanto o player está aberto.
// Sem escolha, vale o de Configurações (que o player não muda).

import type { Title } from '../data/types';
import { getSettings, type AudioLanguage } from '../settings';

const KEY = 'freeflix.audioByTitle';
/** séries lembradas; as mais antigas saem */
const MAX_SERIES = 100;
const open: Record<string, AudioLanguage> = {};

function savedSeries(): { id: string; audio: AudioLanguage }[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function audioFor(title: Pick<Title, 'id' | 'type'>): AudioLanguage {
  if (open[title.id]) return open[title.id];
  if (title.type === 'series') {
    const found = savedSeries().filter((s) => s.id === title.id)[0];
    if (found) return found.audio;
  }
  return getSettings().audio;
}

export function rememberAudio(title: Pick<Title, 'id' | 'type'>, audio: AudioLanguage) {
  if (title.type !== 'series') {
    open[title.id] = audio;
    return;
  }
  const list = [{ id: title.id, audio }].concat(savedSeries().filter((s) => s.id !== title.id)).slice(0, MAX_SERIES);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sem persistência nesta sessão */
  }
}

/** O player do filme fechou: a próxima abertura volta ao áudio de Configurações. */
export function forgetMovieAudio(id: string) {
  delete open[id];
}
