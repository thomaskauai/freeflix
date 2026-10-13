import { useNavigate } from 'react-router-dom';

/** Volta uma tela; se o app abriu direto nesta rota, vai para o Início. */
export function useGoBack() {
  const navigate = useNavigate();
  return () => {
    const state = window.history.state as { idx?: number } | null;
    if (state && typeof state.idx === 'number' && state.idx > 0) navigate(-1);
    else navigate('/', { replace: true });
  };
}
