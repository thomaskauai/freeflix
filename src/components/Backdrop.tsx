import { useState } from 'react';
import type { Title } from '../data/types';

interface BackdropProps {
  title: Title;
  /** sombra à esquerda e embaixo, para texto por cima */
  shade?: boolean;
}

/**
 * Fundo de tela cheia. Com fotograma, ele ocupa a tela. Sem fotograma, o
 * cartaz aparece inteiro à direita, sobre uma versão desfocada dele mesmo.
 */
export function Backdrop({ title, shade = true }: BackdropProps) {
  const [loaded, setLoaded] = useState(false);
  const [posterLoaded, setPosterLoaded] = useState(false);
  const src = title.backdrop ?? title.poster;
  const posterOnly = !title.backdrop && !!title.poster;

  return (
    <div className="backdrop">
      {src && (
        <img
          key={src}
          className={`backdrop__img${posterOnly ? ' backdrop__img--poster' : ''}${loaded ? ' is-loaded' : ''}`}
          src={src}
          alt=""
          onLoad={() => setLoaded(true)}
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
