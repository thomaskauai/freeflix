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

  const showImage = (img: HTMLImageElement) => {
    setWide(img.naturalWidth / img.naturalHeight >= WIDE_RATIO);
    setLoaded(true);
  };
  // Imagem que já veio da tela anterior está em cache: aparece já no primeiro
  // quadro, sem o fade de carregamento (que faria o fundo piscar ao dar play).
  const cached = (img: HTMLImageElement | null) => !!img && img.complete && img.naturalWidth > 0;

  return (
    <div className="backdrop">
      {src && (
        <img
          key={src}
          className={classes}
          src={src}
          alt=""
          decoding="async"
          ref={(img) => {
            if (img && !loaded && cached(img)) showImage(img);
          }}
          onLoad={(e) => showImage(e.currentTarget)}
        />
      )}
      {shade && <div className="backdrop__shade" />}
      {posterOnly && (
        <img
          className={`backdrop__poster${posterLoaded ? ' is-loaded' : ''}`}
          src={title.poster}
          alt=""
          decoding="async"
          ref={(img) => {
            if (img && !posterLoaded && cached(img)) setPosterLoaded(true);
          }}
          onLoad={() => setPosterLoaded(true)}
        />
      )}
    </div>
  );
}
