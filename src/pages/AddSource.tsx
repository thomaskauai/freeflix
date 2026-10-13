import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../components/Button';
import { usePageFocus } from '../focus/useFocusable';
import { useGoBack } from '../nav';
import { INSTALL_ERRORS, installSource, SourceError, type SourceAddon } from '../streams/sources';

type State =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'error'; message: string }
  | { status: 'done'; addon: SourceAddon };

/** Instala uma fonte de vídeo pelo link do manifest. Por ora, digitando ou colando no computador. */
export default function AddSource() {
  const goBack = useGoBack();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });

  // campo ao abrir; botão Concluir quando a instalação termina
  usePageFocus(true, state.status === 'done' ? 'done' : 'form');

  const submit = (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!url.trim() || state.status === 'checking') return;
    setState({ status: 'checking' });
    installSource(url).then(
      (addon) => setState({ status: 'done', addon }),
      (err) =>
        setState({
          status: 'error',
          message: err instanceof SourceError ? INSTALL_ERRORS[err.code] : INSTALL_ERRORS.unreachable,
        }),
    );
  };

  return (
    <div className="page settings" data-focus-main="">
      <div className="page-head">
        <h1 className="page-head__title display">Adicionar fonte</h1>
      </div>

      <section className="settings__block">
        {state.status === 'done' ? (
          <>
            <h2 className="settings__title">{state.addon.name} instalada</h2>
            <p className="settings__note">
              Ao dar play, o Freeflix consulta esta fonte e escolhe sozinho o melhor vídeo para a sua rede e idioma.
            </p>
            <div className="settings__options">
              <Button variant="pill" id="add-done" autoFocus onClick={goBack}>
                Concluir
              </Button>
            </div>
          </>
        ) : (
          // noValidate: a validação nativa de type="url" barraria o envio em silêncio;
          // quem explica o erro é installSource
          <form onSubmit={submit} noValidate>
            <h2 className="settings__title">Link do manifest</h2>
            <p className="settings__note">
              Cole o endereço que termina em manifest.json.
            </p>
            <input
              ref={input}
              className="settings__input"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://…/manifest.json"
              value={url}
              tabIndex={-1}
              data-focusable=""
              data-autofocus=""
              data-focus-id="source-url"
              onChange={(e) => {
                setUrl(e.target.value);
                if (state.status === 'error') setState({ status: 'idle' });
              }}
            />
            {state.status === 'error' && <p className="settings__error">{state.message}</p>}
            <div className="settings__options">
              <Button variant="pill" id="add-submit" onClick={() => submit()}>
                {state.status === 'checking' ? 'Verificando…' : 'Adicionar'}
              </Button>
              <Button variant="pill" id="add-cancel" onClick={goBack}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
