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

export function Meta({ title }: { title: Title }) {
  const length =
    title.type === 'series'
      ? title.seasonCount > 1
        ? `${title.seasonCount} temporadas`
        : `${title.episodeCount} episódios`
      : formatRuntime(title.runtime);

  return (
    <div className="meta">
      <span className="meta__year">{title.year}</span>
      <span>{length}</span>
      <span>{title.genres.join(', ')}</span>
      <span className="meta__badge">Domínio público</span>
    </div>
  );
}
