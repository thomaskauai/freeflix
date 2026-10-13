import { useState } from 'react';
import type { Title } from '../data/types';

interface BackdropProps {
  title: Title;
  /** sombra à esquerda e embaixo, para texto por cima */
  shade?: boolean;
}

/** a partir desta proporção a imagem é widescreen e cobre a tela inteira */
const WIDE_RATIO = 1.6;

/**
 * Fundo de tela cheia. Com fotograma, ele ocupa a tela (inteira se for
 * widescreen; encostado à direita se for 4:3). Sem fotograma, o cartaz aparece
 * inteiro à direita, sobre uma versão desfocada dele mesmo.
 */
export function Backdrop({ title, shade = true }: BackdropProps) {
  const [loaded, setLoaded] = useState(false);
  const [wide, setWide] = useState(false);
  const [posterLoaded, setPosterLoaded] = useState(false);
  const src = title.backdrop ?? title.poster;
  const posterOnly = !title.backdrop && !!title.poster;
  const classes = [
    'backdrop__img',
    posterOnly ? 'backdrop__img--poster' : '',
    wide && !posterOnly ? 'backdrop__img--wide' : '',
    loaded ? 'is-loaded' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="backdrop">
      {src && (
        <img
          key={src}
          className={classes}
          src={src}
          alt=""
          onLoad={(e) => {
            setWide(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight >= WIDE_RATIO);
            setLoaded(true);
          }}
        />
      )}
      {shade && <div className="backdrop__shade" />}
      {posterOnly && (
        <img
          className={`backdrop__poster${posterLoaded ? ' is-loaded' : ''}`}
          src={title.poster}
          alt=""
          onLoad={() => setPosterLoaded(true)}
        />
      )}
    </div>
  );
}
