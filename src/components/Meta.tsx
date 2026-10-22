import { GENRE_LABELS_PT } from '../data/catalogNames';
import { kindLabel, type Title } from '../data/types';
import { CATALOG } from '../settings';

export function formatRuntime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Selo de tipo com a inicial da marca, na posição do selo da referência. */
export function KindTag({ title }: { title: Pick<Title, 'type' | 'genres'> }) {
  return (
    <div className="kind">
      <span className="kind__mark display">F</span>
      {kindLabel(title)}
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

// o catálogo em português traduz títulos e sinopses, mas manda os gêneros em inglês
const genreLabel = (genre: string) => (CATALOG.localized && GENRE_LABELS_PT[genre]) || genre;

/** Só o que o catálogo informou; nada aqui é inventado para preencher a linha. */
export function Meta({ title }: { title: Title }) {
  const length = lengthOf(title);
  return (
    <div className="meta">
      {title.year && <span className="meta__year">{title.year}</span>}
      {length && <span>{length}</span>}
      {title.rating && <span className="meta__rating">IMDb {title.rating}</span>}
      {title.genres.length > 0 && <span>{title.genres.slice(0, 3).map(genreLabel).join(', ')}</span>}
    </div>
  );
}
