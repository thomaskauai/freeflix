import { useNavigate, type NavigateFunction } from 'react-router-dom';
import type { Title } from './data/types';

export const titlePath = (t: Pick<Title, 'type' | 'id'>) => `/title/${t.type}/${encodeURIComponent(t.id)}`;

export const watchPath = (t: Pick<Title, 'type' | 'id'>, season?: number, episode?: number) =>
  `/watch/${t.type}/${encodeURIComponent(t.id)}${season != null && episode != null ? `/${season}/${episode}` : ''}`;

/** Volta uma tela; se o app abriu direto nesta rota, vai para o Início. */
export function useGoBack() {
  const navigate = useNavigate();
  return () => {
    const state = window.history.state as { idx?: number } | null;
    if (state && typeof state.idx === 'number' && state.idx > 0) navigate(-1);
    else navigate('/', { replace: true });
  };
}

/**
 * navigate do App, para quem não deve renderizar de novo a cada troca de rota:
 * useNavigate renderiza o componente a cada mudança de endereço, e os cards da
 * Home guardada por baixo dos detalhes eram todos refeitos ao abrir e ao voltar.
 */
let appNavigate: NavigateFunction | null = null;
export const setAppNavigate = (navigate: NavigateFunction) => {
  appNavigate = navigate;
};
/** Abre um endereço absoluto ("/title/…") sem depender da rota atual. */
export const navigateTo = (path: string) => {
  if (appNavigate) appNavigate(path);
};
