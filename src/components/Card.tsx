import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Title } from '../data/types';
import { useFocusable } from '../focus/useFocusable';
import { titlePath } from '../nav';

interface CardProps {
  title: Title;
  variant: 'poster' | 'tall';
  focusId: string;
  autoFocus?: boolean;
  /** 0..1, mostra a barra de "continuar assistindo" */
  progress?: number;
  /** y de repouso em grades; fileiras ancoram pela própria Row */
  anchor?: number;
}

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
export function Card({ title, variant, focusId, autoFocus, progress, anchor }: CardProps) {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const focus = useFocusable({ id: focusId, autoFocus });
  const hasImage = !!title.poster && !failed;

  return (
    <div
      {...focus}
      className={`card card--${variant}`}
      aria-label={title.title}
      data-scroll-anchor={anchor}
      onClick={() => navigate(titlePath(title))}
    >
      <div className="card__art">
        {hasImage ? (
          <img
            className={`card__img${loaded ? ' is-loaded' : ''}`}
            src={title.poster}
            alt=""
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
          {title.year ? `${title.year} • ` : ''}
          {title.type === 'series' ? 'Série' : 'Filme'}
        </div>
      </div>
    </div>
  );
}
