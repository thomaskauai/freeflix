import { useNavigate } from 'react-router-dom';
import { Button } from './Button';

/** Catálogo que não respondeu: diz o que houve e oferece as duas saídas possíveis. */
export function PageError() {
  const navigate = useNavigate();
  return (
    <div className="empty">
      <p className="empty__title">O catálogo não respondeu</p>
      <p className="empty__text">
        Confira a conexão e tente de novo. Se continuar assim, troque de catálogo em Configurações.
      </p>
      <div className="empty__actions">
        <Button id="error-retry" autoFocus onClick={() => window.location.reload()}>
          Tentar de novo
        </Button>
        <Button id="error-settings" onClick={() => navigate('/settings')}>
          Abrir Configurações
        </Button>
      </div>
    </div>
  );
}
