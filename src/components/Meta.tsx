import type { Title, TitleType } from '../data/types';

export function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Selo de tipo com a inicial da marca, na posição do selo da referência. */
export function KindTag({ type }: { type: TitleType }) {
  return (
    <div className="kind">
      <span className="kind__mark display">F</span>
      {type === 'series' ? 'Série' : 'Filme'}
    </div>
  );
}

function lengthOf(title: Title): string | null {
  if (title.type === 'series') {
    if (title.seasonCount && title.seasonCount > 1) return `${title.seasonCount} temporadas`;
    if (title.episodeCount) return `${title.episodeCount} episódios`;
    return null;
  }
  return title.runtime ? formatRuntime(title.runtime) : null;
}

/** Só o que o catálogo informou; nada aqui é inventado para preencher a linha. */
export function Meta({ title }: { title: Title }) {
  const length = lengthOf(title);
  return (
    <div className="meta">
      {title.year && <span className="meta__year">{title.year}</span>}
      {length && <span>{length}</span>}
      {title.rating && <span className="meta__rating">IMDb {title.rating}</span>}
      {title.genres.length > 0 && <span>{title.genres.slice(0, 3).join(', ')}</span>}
      {title.publicDomain && <span className="meta__badge">Domínio público</span>}
    </div>
  );
}
