import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { Icon } from './Icon';
import { QrCode } from './QrCode';
import {
  checkPairing,
  houseCode,
  linkHouse,
  startPairing,
  unlinkHouse,
  useSyncVersion,
  type LinkResult,
  type Pairing,
} from '../data/sync';
import { focusElement } from '../focus/FocusContext';
import { useKeyHandler } from '../focus/keys';
import { useFocusable } from '../focus/useFocusable';

const DIGITS = 6;
/** a TV pergunta ao servidor se o celular já criou a casa */
const POLL_MS = 2500;

/** 123 456 */
export const prettyCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

const ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

// Teclas sem id de foco: fechado o modal, a página volta ao "Já tenho um código".
function Key({
  label,
  autoFocus,
  onPress,
  children,
}: {
  label: string;
  autoFocus?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const focus = useFocusable({ autoFocus });
  return (
    <div {...focus} className="pad__key" aria-label={label} onClick={onPress}>
      {children}
    </div>
  );
}

function linkMessage(result: LinkResult | null): string {
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
 * "Já tenho um código", em modal: 6 números pelo teclado da tela (setas e OK)
 * ou pelos números do controle. No sexto número o código já é conferido.
 */
function CodeModal({ onClose, onLinked }: { onClose: () => void; onLinked: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LinkResult | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const type = (digit: string) => {
    if (busyRef.current) return;
    setResult((r) => (r && r.status === 'locked' ? r : null));
    setCode((c) => (c.length < DIGITS ? c + digit : c));
  };
  const erase = () => !busyRef.current && setCode((c) => c.slice(0, -1));

  // sexto número: confere na hora
  useEffect(() => {
    if (code.length !== DIGITS) return;
    let alive = true;
    setBusy(true);
    linkHouse(code).then((r) => {
      if (!alive) return;
      setBusy(false);
      setResult(r);
      if (r.status === 'ok') onLinked();
      else setCode('');
    });
    return () => {
      alive = false;
    };
    // onLinked é estável no ciclo de vida do modal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Voltar fecha o modal (antes de sair da tela).
  useKeyHandler((action) => {
    if (action !== 'back') return false;
    onClose();
    return true;
  }, 5);

  // Números do controle (ou do teclado) digitam direto; Backspace apaga um número.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const top = e.keyCode >= 48 && e.keyCode <= 57;
      const pad = e.keyCode >= 96 && e.keyCode <= 105;
      if (top || pad) {
        e.preventDefault();
        e.stopPropagation();
        type(String(top ? e.keyCode - 48 : e.keyCode - 96));
      } else if (e.keyCode === 8 && codeRef.current.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        erase();
      }
    };
    // captura: chega antes do mapa de teclas do app, que trata Backspace como Voltar
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // O modal vira a camada de foco: abre no 1.
  useEffect(() => {
    focusElement(document.querySelector<HTMLElement>('.modal [data-autofocus]'));
  }, []);

  return (
    <div className="modal" role="dialog" aria-label="Digite o código da casa">
      <div className="modal__box" data-focus-layer="">
        <h2 className="modal__title">Digite o código da casa</h2>
        <p className="modal__note">
          São 6 números, mostrados no celular ou em Configurações de uma TV já sincronizada.
        </p>
        <div className="house__slots" aria-label={`Código digitado: ${code || 'nenhum número'}`}>
          {Array.from({ length: DIGITS }, (_, i) => (
            <span
              key={i}
              className={`house__slot${i === code.length && !busy ? ' is-next' : ''}${i === 2 ? ' is-split' : ''}`}
            >
              {code[i] || ''}
            </span>
          ))}
        </div>
        <p className={`house__status${result && result.status !== 'ok' ? ' is-error' : ''}`}>
          {busy ? 'Conferindo…' : linkMessage(result)}
        </p>
        <div className="pad">
          {ROWS.map((row) => (
            <div key={row[0]} className="pad__row">
              {row.map((d) => (
                <Key key={d} label={d} autoFocus={d === '1'} onPress={() => type(d)}>
                  {d}
                </Key>
              ))}
            </div>
          ))}
          <div className="pad__row">
            <Key label="Apagar" onPress={erase}>
              <Icon name="erase" />
            </Key>
            <Key label="0" onPress={() => type('0')}>
              0
            </Key>
            <Key label="Fechar" onPress={onClose}>
              <Icon name="back" />
            </Key>
          </div>
        </div>
      </div>
    </div>
  );
}

type Creating = { status: 'starting' } | Pairing | { status: 'expired' };

/** Onde o foco cai em cada estado da seção. */
const FOCUS: Record<string, string> = {
  start: 'sync-create',
  'qr:starting': 'sync-back',
  'qr:waiting': 'sync-cancel',
  'qr:expired': 'sync-retry',
  'qr:locked': 'sync-retry',
  'qr:offline': 'sync-retry',
  linked: 'sync-unlink',
  unlink: 'sync-unlink-cancel',
};

/**
 * Seção Sincronizar entre TVs, em Configurações: Continuar assistindo e os
 * episódios assistidos iguais em todas as TVs da casa. Criar código mostra um
 * QR code; o celular que o abrir cria a casa, e esta TV entra nela sozinha. Nas
 * outras TVs, Já tenho um código.
 */
export function SyncSection() {
  useSyncVersion();
  const code = houseCode();
  const [creating, setCreating] = useState<Creating | null>(null);
  const [typing, setTyping] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [justLinked, setJustLinked] = useState(false);

  const view = code
    ? confirmUnlink
      ? 'unlink'
      : 'linked'
    : typing
      ? 'typing'
      : creating
        ? `qr:${creating.status}`
        : 'start';

  // A cada troca de estado o foco vai para o botão novo (o anterior sumiu).
  // Na abertura de Configurações, não: lá o foco é da página.
  const lastView = useRef('');
  useEffect(() => {
    const before = lastView.current;
    lastView.current = view;
    if (!before) return;
    // fechou o modal sem vincular: de volta ao cartão que o abriu
    const id = before === 'typing' && view === 'start' ? 'sync-have' : FOCUS[view];
    if (id) focusElement(document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`));
  }, [view]);

  const create = () => {
    setCreating({ status: 'starting' });
    startPairing().then(setCreating);
  };

  // QR na tela: pergunta de tempos em tempos se o celular já criou a casa.
  const token = creating && creating.status === 'waiting' ? creating.token : null;
  useEffect(() => {
    if (!token) return;
    let alive = true;
    let timer = 0;
    const poll = () => {
      checkPairing(token).then((r) => {
        if (!alive) return;
        if (r === 'waiting') timer = window.setTimeout(poll, POLL_MS);
        else if (r === 'expired') setCreating({ status: 'expired' });
        else if (r.status === 'ok') {
          setCreating(null);
          setJustLinked(true);
        }
      });
    };
    timer = window.setTimeout(poll, POLL_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [token]);

  // Voltar com o QR na tela volta às duas opções.
  useKeyHandler((action) => {
    if (action !== 'back' || !creating || typing) return false;
    setCreating(null);
    return true;
  });

  let body: ReactNode;
  if (code) {
    body = (
      <>
        <p className="settings__note">
          {justLinked ? 'Pronto, esta TV está sincronizada. ' : 'Esta TV está sincronizada. '}
          Continuar assistindo e os episódios assistidos ficam iguais em todas as TVs com este código.
        </p>
        <p className="sync__label">Código da casa</p>
        <p className="house__code display">{prettyCode(code)}</p>
        <p className="settings__note">
          Para sincronizar outra TV: em Configurações dela, Sincronizar entre TVs, escolha Já tenho um código e
          digite estes números.
        </p>
        <div className="settings__options">
          {confirmUnlink ? (
            <>
              <Button
                variant="pill"
                id="sync-unlink-confirm"
                onClick={() => {
                  setConfirmUnlink(false);
                  setJustLinked(false);
                  unlinkHouse();
                }}
              >
                Desvincular
              </Button>
              <Button variant="pill" id="sync-unlink-cancel" onClick={() => setConfirmUnlink(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button variant="pill" id="sync-unlink" onClick={() => setConfirmUnlink(true)}>
              Desvincular esta TV
            </Button>
          )}
        </div>
        {confirmUnlink && (
          <p className="settings__note">
            Esta TV para de sincronizar e fica com o que já tem. As outras TVs continuam com o código.
          </p>
        )}
      </>
    );
  } else if (creating) {
    body =
      creating.status === 'waiting' ? (
        <div className="sync__pair">
          <QrCode text={creating.url} label="QR code para criar o código da casa no celular" />
          <div className="sync__steps">
            <p className="sync__lead">Aponte a câmera do celular para o QR code</p>
            <ol>
              <li>O celular cria e mostra o código da casa.</li>
              <li>Esta TV sincroniza sozinha.</li>
              <li>Nas outras TVs, use Já tenho um código.</li>
            </ol>
            <p className="sync__waiting">
              <span className="sync__dot" />
              Esperando o celular…
            </p>
            <div className="settings__options">
              <Button variant="pill" id="sync-cancel" onClick={() => setCreating(null)}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <p className={creating.status === 'starting' ? 'settings__note' : 'settings__error'}>
            {creating.status === 'starting'
              ? 'Gerando o QR code…'
              : creating.status === 'expired'
                ? 'O QR code expirou. Gere outro.'
                : creating.status === 'locked'
                  ? `Muitos QR codes gerados por esta rede. Tente de novo em ${creating.minutes} min.`
                  : 'Sem conexão com o servidor. Confira a internet e tente de novo.'}
          </p>
          <div className="settings__options">
            {creating.status !== 'starting' && (
              <Button variant="pill" id="sync-retry" onClick={create}>
                Gerar outro
              </Button>
            )}
            <Button variant="pill" id="sync-back" onClick={() => setCreating(null)}>
              Voltar
            </Button>
          </div>
        </>
      );
  } else {
    body = (
      <>
        <p className="settings__note">
          Continuar assistindo e os episódios assistidos iguais em todas as TVs da casa, sem conta nem e-mail.
        </p>
        <div className="sync__choices">
          <ChoiceCard
            id="sync-create"
            title="Criar código"
            text="Primeira TV da casa: o celular cria o código por um QR code."
            onSelect={create}
          />
          <ChoiceCard
            id="sync-have"
            title="Já tenho um código"
            text="Outra TV já está sincronizada: digite os 6 números."
            onSelect={() => setTyping(true)}
          />
        </div>
      </>
    );
  }

  // O modal sai da área que rola: fica preso à tela, por cima de tudo.
  const host = document.querySelector('.page.settings');
  return (
    <section className="settings__block" data-scroll-anchor="200">
      <h2 className="settings__title">Sincronizar entre TVs</h2>
      {body}
      {typing &&
        !code &&
        host &&
        createPortal(
          <CodeModal
            onClose={() => setTyping(false)}
            onLinked={() => {
              setTyping(false);
              setJustLinked(true);
            }}
          />,
          host,
        )}
    </section>
  );
}

function ChoiceCard({
  id,
  title,
  text,
  autoFocus,
  onSelect,
}: {
  id: string;
  title: string;
  text: string;
  autoFocus?: boolean;
  onSelect: () => void;
}) {
  const focus = useFocusable({ id, autoFocus });
  return (
    <div {...focus} className="sync__choice" aria-label={title} onClick={onSelect}>
      <span className="sync__choice-title">{title}</span>
      <span className="sync__choice-text">{text}</span>
    </div>
  );
}
