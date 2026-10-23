// Animes fora do catálogo, a menos que "Incluir animes" esteja ligado nas
// Configurações. Os itens das listas só trazem os gêneros (sem país nem
// idioma), então quem diz o que é anime é a lista do api/justwatch.ts:
// animação do Japão, da China ou da Coreia. Fica guardada no aparelho para a
// próxima abertura já filtrar sem esperar o site.
import { getSettings } from '../settings';
import { fetchCached } from './addonClient';
import { API_BASE } from './site';
import { read, write } from './storage';
import type { Title } from './types';

/** sem lista guardada, as fileiras esperam o site no máximo isso; depois entram sem filtro */
const FIRST_WAIT_MS = 2500;

const toSet = (list: string[]) => {
  const set: Record<string, boolean> = {};
  list.forEach((id) => (set[id] = true));
  return set;
};

let ids = toSet(read<string[]>('anime-ids', []));
let loading: Promise<void> | null = null;

/** Busca a lista uma vez por abertura do app; falha não fica guardada. */
function load(): Promise<void> {
  if (!loading) {
    loading = fetchCached<{ ids?: string[] }>(`${API_BASE.replace(/\/$/, '')}/api/justwatch?list=anime-ids`).then(
      (r) => {
        if (!r.ids || !r.ids.length) return;
        ids = toSet(r.ids);
        write('anime-ids', r.ids);
      },
      () => {
        loading = null;
      },
    );
  }
  return loading;
}

const isAnime = (t: Title) => !!ids[t.id] || (!!t.imdbId && !!ids[t.imdbId]);

/** A lista sem os animes, se "Incluir animes" estiver desligado. */
export async function withoutAnime(list: Title[]): Promise<Title[]> {
  if (getSettings().animes) return list;
  if (Object.keys(ids).length) load();
  else await Promise.race([load(), new Promise((resolve) => window.setTimeout(resolve, FIRST_WAIT_MS))]);
  return list.filter((t) => !isAnime(t));
}
