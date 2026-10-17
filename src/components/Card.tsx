import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { catalog } from '../data/provider';
import type { Title } from '../data/types';
import { useFocusable } from '../focus/useFocusable';
import { titlePath } from '../nav';

interface CardProps {
  title: Title;
  variant: 'poster' | 'tall' | 'wide';
  focusId: string;
  autoFocus?: boolean;
  /** 0..1, mostra a barra de "continuar assistindo" */
  progress?: number;
  /** y de repouso em grades; fileiras ancoram pela própria Row */
  anchor?: number;
  /** nota IMDb no lugar do ano */
  showRating?: boolean;
  /** imagem no lugar do cartaz (no cartão horizontal, a do episódio ou o fotograma) */
  image?: string;
  /** linha de informação no lugar de ano e tipo */
  info?: string;
  /** escolher o card; sem isso, abre os detalhes */
  onSelect?: () => void;
}

/** foco parado por este tempo num cartão adianta a busca dos detalhes */
const PREFETCH_AFTER_MS = 400;

// Matiz estável por título, para as cartelas sem pôster não ficarem iguais.
function hueOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

/** Fundo das cartelas e miniaturas de um título sem imagem. */
export function fallbackArt(id: string) {
  const hue = hueOf(id);
  return `linear-gradient(160deg, hsl(${hue}, 32%, 20%) 0%, hsl(${hue}, 40%, 7%) 100%)`;
}

/** Cartaz arredondado com título e uma linha de informação embaixo. */
export function Card({
  title,
  variant,
  focusId,
  autoFocus,
  progress,
  anchor,
  showRating,
  image,
  info,
  onSelect,
}: CardProps) {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const focus = useFocusable({ id: focusId, autoFocus });
  const picture = image ?? (variant === 'wide' ? (title.backdrop ?? title.poster) : title.poster);
  const hasImage = !!picture && !failed;

  // Foco parado no cartão: os detalhes deste título já começam a ser buscados,
  // porque o servidor do catálogo leva segundos. Passando direto, nada é pedido.
  const prefetch = useRef(0);
  useEffect(() => () => window.clearTimeout(prefetch.current), []);
  const onFocus = () => {
    window.clearTimeout(prefetch.current);
    prefetch.current = window.setTimeout(() => {
      catalog.getTitle(title.type, title.id).catch(() => undefined);
    }, PREFETCH_AFTER_MS);
  };

  return (
    <div
      {...focus}
      className={`card card--${variant}`}
      aria-label={title.title}
      data-scroll-anchor={anchor}
      onFocus={onFocus}
      onBlur={() => window.clearTimeout(prefetch.current)}
      onClick={onSelect ?? (() => navigate(titlePath(title)))}
    >
      <div className="card__art">
        {hasImage ? (
          <img
            className={`card__img${loaded ? ' is-loaded' : ''}`}
            src={picture}
            alt=""
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="titlecard" style={{ background: fallbackArt(title.id) }}>
            <span className="titlecard__name display">{title.title}</span>
          </div>
        )}
        {progress != null && (
          <div className="card__progress">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="card__text">
        <div className="card__title">{title.title}</div>
        <div className="card__info">
          {info ?? (
            <>
              {showRating && title.rating ? (
                <span className="card__rating">IMDb {title.rating} • </span>
              ) : title.year ? (
                `${title.year} • `
              ) : (
                ''
              )}
              {title.type === 'series' ? 'Série' : 'Filme'}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
