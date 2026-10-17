import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { linkHouse, type LinkResult } from '../data/sync';
import { focusElement } from '../focus/FocusContext';
import { useFocusable, usePageFocus } from '../focus/useFocusable';
import { useGoBack } from '../nav';

const DIGITS = 8;
/** teclado numérico como o de telefone: 1 2 3 / 4 5 6 / 7 8 9 / apagar 0 OK */
const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

function Key({
  id,
  label,
  wide,
  autoFocus,
  disabled,
  onPress,
  children,
}: {
  id: string;
  label: string;
  wide?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const focus = useFocusable({ id: `pad:${id}`, autoFocus });
  return (
    <div
      {...focus}
      className={`pad__key${wide ? ' pad__key--wide' : ''}${disabled ? ' is-disabled' : ''}`}
      aria-label={label}
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onPress()}
    >
      {children}
    </div>
  );
}

function message(result: LinkResult | null): string {
  if (!result) return '';
  if (result.status === 'not-found') {
    if (result.left <= 0) return 'Código não encontrado.';
    const left = result.left === 1 ? 'Resta 1 tentativa' : `Restam ${result.left} tentativas`;
    return `Código não encontrado. Confira os números. ${left} antes de um bloqueio temporário.`;
  }
  if (result.status === 'locked') {
    return `Muitos códigos errados seguidos. Esta TV pode tentar de novo em ${result.minutes} min.`;
  }
  if (result.status === 'offline') return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  return '';
}

/**
 * "Já tenho um código": 8 dígitos pelo teclado da tela (setas e OK) ou pelos
 * números do controle. Código certo liga esta TV à casa e traz o histórico.
 */
export default function LinkHouse() {
  const goBack = useGoBack();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LinkResult | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;

  usePageFocus(true, result && result.status === 'ok' ? 'done' : 'pad');

  const type = (digit: string) => {
    if (busy) return;
    setResult((r) => (r && r.status === 'locked' ? r : null));
    setCode((c) => (c.length < DIGITS ? c + digit : c));
  };
  const erase = () => {
    if (busy) return;
    setCode((c) => c.slice(0, -1));
  };

  const submit = () => {
    const current = codeRef.current;
    if (busy || current.length !== DIGITS) return;
    setBusy(true);
    linkHouse(current).then((r) => {
      setBusy(false);
      setResult(r);
      if (r.status === 'not-found') setCode('');
    });
  };

  // Números do controle (ou do teclado do computador) digitam direto. Apagar
  // (Backspace) apaga um número enquanto houver algum; sem número, volta a tela.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const top = e.keyCode >= 48 && e.keyCode <= 57;
      const pad = e.keyCode >= 96 && e.keyCode <= 105;
      const digit = top ? e.keyCode - 48 : pad ? e.keyCode - 96 : -1;
      if (digit >= 0) {
        e.preventDefault();
        e.stopPropagation();
        type(String(digit));
      } else if (e.keyCode === 8 && codeRef.current.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        erase();
      }
    };
    // captura: chega antes do mapa de teclas do app, que trata Backspace como Voltar
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // type e erase só leem estado por função
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // Oito números: o foco vai para o botão de vincular.
  useEffect(() => {
    if (code.length === DIGITS) focusElement(document.querySelector<HTMLElement>('[data-focus-id="pad:ok"]'));
  }, [code]);

  if (result && result.status === 'ok') {
    return (
      <div className="page settings" data-focus-main="">
        <div className="page-head">
          <h1 className="page-head__title display">TV vinculada</h1>
        </div>
        <section className="settings__block">
          <p className="house__code display">{`${result.code.slice(0, 4)} ${result.code.slice(4)}`}</p>
          <p className="settings__note">
            Continuar assistindo e os episódios assistidos desta casa já aparecem nesta TV, e o que for assistido aqui
            aparece nas outras.
          </p>
          <div className="settings__options">
            <Button variant="pill" id="house-done" autoFocus onClick={goBack}>
              Concluir
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const locked = !!result && result.status === 'locked';
  const ready = code.length === DIGITS && !busy && !locked;

  return (
    <div className="page settings" data-focus-main="">
      <div className="page-head">
        <h1 className="page-head__title display">Código da casa</h1>
      </div>
      <section className="settings__block house">
        <p className="settings__note">
          Digite o código de 8 números que aparece em Configurações na TV onde ele foi criado. Dá para usar os números do
          controle.
        </p>
        <div className="house__slots" aria-label={`Código digitado: ${code || 'nenhum número'}`}>
          {Array.from({ length: DIGITS }, (_, i) => (
            <span
              key={i}
              className={`house__slot${i === code.length && !busy ? ' is-next' : ''}${i === 3 ? ' is-split' : ''}`}
            >
              {code[i] || ''}
            </span>
          ))}
        </div>
        <p className={`house__status${result ? ' is-error' : ''}`}>
          {busy ? 'Verificando…' : message(result)}
        </p>
        <div className="pad">
          {ROWS.map((row) => (
            <div key={row[0]} className="pad__row">
              {row.map((d) => (
                <Key key={d} id={d} label={d} autoFocus={d === '1'} onPress={() => type(d)}>
                  {d}
                </Key>
              ))}
            </div>
          ))}
          <div className="pad__row">
            <Key id="erase" label="Apagar" onPress={erase}>
              <Icon name="erase" />
            </Key>
            <Key id="0" label="0" onPress={() => type('0')}>
              0
            </Key>
            <Key id="ok" label="Vincular" disabled={!ready} onPress={submit}>
              <Icon name="check" />
            </Key>
          </div>
        </div>
        <div className="settings__options">
          <Button variant="pill" id="house-cancel" onClick={goBack}>
            Cancelar
          </Button>
        </div>
      </section>
    </div>
  );
}
