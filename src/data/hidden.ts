// Títulos fora do catálogo, por listas de ids IMDb do api/justwatch.ts. Os
// itens das listas só trazem os gêneros (sem país, idioma nem onde passa),
// então quem diz o que esconder é o site. Cada lista fica guardada no aparelho
// para a próxima abertura já filtrar sem esperar o site.
import { getSettings } from '../settings';
import { fetchCached } from './addonClient';
import { API_BASE } from './site';
import { read, write } from './storage';
import type { Title } from './types';

/** sem lista guardada, as fileiras esperam o site no máximo isso; depois entram sem filtro */
const FIRST_WAIT_MS = 2500;

/** Uma lista do site: buscada uma vez por abertura do app; falha não fica guardada. */
function idList(name: string) {
  const toSet = (list: string[]) => {
    const set: Record<string, boolean> = {};
    list.forEach((id) => (set[id] = true));
    return set;
  };
  let ids = toSet(read<string[]>(name, []));
  let loading: Promise<void> | null = null;

  const load = (): Promise<void> => {
    if (!loading) {
      loading = fetchCached<{ ids?: string[] }>(`${API_BASE.replace(/\/$/, '')}/api/justwatch?list=${name}`).then(
        (r) => {
          if (!r.ids) return;
          ids = toSet(r.ids);
          write(name, r.ids);
        },
        () => {
          loading = null;
        },
      );
    }
    return loading;
  };

  const has = (t: Title) => !!ids[t.id] || (!!t.imdbId && !!ids[t.imdbId]);

  return async (list: Title[]): Promise<Title[]> => {
    if (Object.keys(ids).length) load();
    else await Promise.race([load(), new Promise((resolve) => window.setTimeout(resolve, FIRST_WAIT_MS))]);
    return list.filter((t) => !has(t));
  };
}

/**
 * Animes: animação do Japão, da China ou da Coreia. Ficam de fora a menos que
 * "Incluir animes" esteja ligado nas Configurações.
 */
const animeFilter = idList('anime-ids');
export const withoutAnime = (list: Title[]) => (getSettings().animes ? Promise.resolve(list) : animeFilter(list));

/** Filmes que só passam no cinema, em nenhum lugar do mundo com cópia digital: o que existe deles é gravação de cinema. */
export const withoutCinema = idList('cinema-ids');

/** Tudo o que o catálogo esconde. */
export const withoutHidden = (list: Title[]) => withoutAnime(list).then(withoutCinema);
