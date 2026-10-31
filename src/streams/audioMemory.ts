// Áudio, legenda e fonte escolhidos no player, por título: Continuar
// assistindo volta com eles. Série: valem para os próximos episódios. Filme:
// enquanto estiver em andamento; visto até o fim ou recomeçado do início,
// volta ao de Configurações (que o player não muda).

import {
  forgetChoice,
  getChoice,
  getProgress,
  isFinished,
  preferredSource,
  rememberSource,
  saveChoice,
  type Progress,
  type SubtitleChoice,
  type TitleChoice,
} from '../data/storage';
import type { Title } from '../data/types';
import { getSettings, type AudioLanguage } from '../settings';
import type { SourceProfile } from './rank';

const KEY = 'freeflix.audioByTitle';
/** séries lembradas; as mais antigas saem */
const MAX_SERIES = 100;
/** filme sem progresso gravado ainda (acabou de abrir): a escolha vale por este tempo */
const FRESH_MS = 60 * 60 * 1000;

type TitleRef = Pick<Title, 'id' | 'type'>;

function savedSeries(): { id: string; audio: AudioLanguage }[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * A escolha do filme ainda vale? Em andamento, sim; visto até o fim, só se foi
 * feita depois (reviu o filme). Sem progresso, só a recém-feita.
 */
export function movieChoiceLives(progress: Progress | undefined, choiceAt: number, now: number): boolean {
  if (progress) return !isFinished(progress) || choiceAt > progress.updatedAt;
  return now - choiceAt < FRESH_MS;
}

/** As escolhas do título que estão valendo (série: sempre). */
function choiceOf(title: TitleRef): TitleChoice | undefined {
  const choice = getChoice(title.id);
  if (!choice || title.type === 'series') return choice;
  return movieChoiceLives(getProgress(title.id), choice.at, Date.now()) ? choice : undefined;
}

/** Grava uma escolha; a de antes que não vale mais (filme visto até o fim) não volta junto. */
function save(title: TitleRef, change: Partial<Omit<TitleChoice, 'at'>>) {
  if (title.type !== 'series' && getChoice(title.id) && !choiceOf(title)) forgetChoice(title.id);
  saveChoice(title.id, change);
}

export function audioFor(title: TitleRef): AudioLanguage {
  if (title.type === 'series') {
    const found = savedSeries().filter((s) => s.id === title.id)[0];
    if (found) return found.audio;
  } else {
    const choice = choiceOf(title);
    if (choice && choice.audio) return choice.audio;
  }
  return getSettings().audio;
}

export function rememberAudio(title: TitleRef, audio: AudioLanguage) {
  if (title.type !== 'series') {
    save(title, { audio });
    return;
  }
  const list = [{ id: title.id, audio }].concat(savedSeries().filter((s) => s.id !== title.id)).slice(0, MAX_SERIES);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* sem persistência nesta sessão */
  }
}

/** Fonte que tocou por último: a próxima abertura (ou o próximo episódio) procura a mesma opção. */
export function sourceFor(title: TitleRef): SourceProfile | undefined {
  if (title.type === 'series') return preferredSource(title.id);
  const choice = choiceOf(title);
  return choice ? choice.source : undefined;
}

export function rememberSourceOf(title: TitleRef, profile: SourceProfile) {
  if (title.type === 'series') rememberSource(title.id, profile);
  else save(title, { source: profile });
}

/** Legenda escolhida neste título; undefined quando não há (vale a última usada no player). */
export function subtitleFor(title: TitleRef): SubtitleChoice | undefined {
  const choice = choiceOf(title);
  return choice ? choice.subtitle : undefined;
}

/** a legenda do título antes da última escolha: troca de áudio que não deu certo volta a ela */
let previous: { id: string; subtitle: SubtitleChoice | undefined } | null = null;

export function rememberTitleSubtitle(title: TitleRef, subtitle: SubtitleChoice) {
  const before = subtitleFor(title);
  if (before && JSON.stringify(before) === JSON.stringify(subtitle)) return;
  previous = { id: title.id, subtitle: before };
  save(title, { subtitle });
}

/** Desfaz a última escolha de legenda do título (o áudio pedido junto com ela não existe). */
export function undoTitleSubtitle(title: TitleRef) {
  if (!previous || previous.id !== title.id) return;
  save(title, { subtitle: previous.subtitle });
  previous = null;
}

/** Filme recomeçado do início: a próxima abertura volta ao áudio, legenda e fonte de Configurações. */
export function forgetMovieChoices(title: TitleRef) {
  if (title.type !== 'series') forgetChoice(title.id);
}
