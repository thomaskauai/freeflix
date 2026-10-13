import { useNavigate } from 'react-router-dom';
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
