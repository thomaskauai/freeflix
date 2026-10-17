import { episodeProgressOf, getEpisodeProgress, getProgress, isFinished } from './storage';
import type { Episode, Season } from './types';

export function findEpisode(seasons: Season[], season: number, episode: number): Episode | undefined {
  const s = seasons.filter((x) => x.number === season)[0];
  return s ? s.episodes.filter((e) => e.number === episode)[0] : undefined;
}

/** O episódio depois deste: o seguinte da temporada ou o primeiro da próxima. */
export function followingEpisode(
  seasons: Season[],
  season: number,
  episode: number,
): { season: number; episode: Episode } | null {
  for (let i = 0; i < seasons.length; i++) {
    if (seasons[i].number < season) continue;
    const later = seasons[i].episodes.filter((e) => seasons[i].number > season || e.number > episode)[0];
    if (later) return { season: seasons[i].number, episode: later };
  }
  return null;
}

/**
 * Episódio do botão principal: onde o espectador parou; visto até o fim, o
 * seguinte; nunca aberto, o primeiro.
 */
export function resumeEpisode(id: string, seasons: Season[]): { season: number; episode: number } {
  const saved = getProgress(id);
  if (saved && saved.season != null && saved.episode != null) {
    const own = episodeProgressOf(getEpisodeProgress(id), saved.season, saved.episode) ?? saved;
    const after = isFinished(own) ? followingEpisode(seasons, saved.season, saved.episode) : null;
    return after
      ? { season: after.season, episode: after.episode.number }
      : { season: saved.season, episode: saved.episode };
  }
  const first = seasons[0];
  return { season: first ? first.number : 1, episode: first && first.episodes[0] ? first.episodes[0].number : 1 };
}
