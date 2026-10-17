import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { ScrollArea } from '../components/ScrollArea';
import { Icon, type IconName } from '../components/Icon';
import { focusElement } from '../focus/FocusContext';
import { createHouse, houseCode, unlinkHouse, useSyncVersion, type LinkResult } from '../data/sync';
import { useFocusable, usePageFocus } from '../focus/useFocusable';
import { AUDIO_LANGUAGES, getSettings, saveSettings, type AudioLanguage } from '../settings';
import { lastSpeed, measureSpeed, type SpeedReading } from '../streams/network';
import { resolutionCap } from '../streams/rank';
import {
  INSTALL_ERRORS,
  installDefaultSources,
  installSource,
  isInstalled,
  listedSources,
  listSources,
  removeSource,
  SourceError,
  type ListedSource,
} from '../streams/sources';

function qualityFor(mbps: number) {
  const cap = resolutionCap(mbps);
  return cap >= 2160 ? '1080p (4K só se for a única opção)' : `até ${cap}p`;
}

/**
 * Uma fonte por linha, compacta: só o nome e a ação. A linha inteira é o item
 * focável, para o controle alcançá-la descendo pela esquerda.
 */
function SourceRow({
  id,
  name,
  icon,
  action,
  error,
  onSelect,
}: {
  id: string;
  name: string;
  icon: IconName;
  action: string;
  error?: string;
  onSelect: () => void;
}) {
  const focus = useFocusable({ id });
  return (
    <div {...focus} className="settings__source" aria-label={`${action} ${name}`} onClick={onSelect}>
      <Icon name={icon} />
      <div className="settings__source-name">
        {name}
        {error && <span className="settings__source-error">{error}</span>}
      </div>
      <span className="settings__source-action">{action}</span>
    </div>
  );
}

const pretty = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;

/**
 * Sincronizar histórico entre TVs: sem código, cria um ou vai digitar um que já
 * existe; com código, mostra o código e o aviso para anotar.
 */
function HouseSync() {
  const navigate = useNavigate();
  useSyncVersion();
  const code = houseCode();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<LinkResult | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

  // O botão em foco some (criou, desvinculou, pediu confirmação): o foco vai para o novo.
  useEffect(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const id = !code ? 'house-create' : confirmUnlink ? 'house-unlink-cancel' : 'house-unlink';
    focusElement(document.querySelector<HTMLElement>(`[data-focus-id="${id}"]`));
  }, [code, confirmUnlink]);

  const create = () => {
    if (creating) return;
    setCreating(true);
    setError(null);
    createHouse().then((r) => {
      setCreating(false);
      if (r.status !== 'ok') setError(r);
    });
  };

  if (code) {
    return (
      <section className="settings__block" data-scroll-anchor="top">
        <h2 className="settings__title">Sincronizar histórico entre TVs</h2>
        <p className="settings__note">Código da casa</p>
        <p className="house__code display">{pretty(code)}</p>
        <p className="settings__warning">Anote este código. Sem ele não é possível recuperar o histórico.</p>
        <p className="settings__note">
          Nas outras TVs: Configurações, Sincronizar histórico entre TVs, Já tenho um código. Continuar assistindo e os
          episódios assistidos ficam iguais em todas.
        </p>
        <div className="settings__options">
          {confirmUnlink ? (
            <>
              <Button
                variant="pill"
                id="house-unlink-confirm"
                onClick={() => {
                  setConfirmUnlink(false);
                  unlinkHouse();
                }}
              >
                Desvincular
              </Button>
              <Button variant="pill" id="house-unlink-cancel" onClick={() => setConfirmUnlink(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button variant="pill" id="house-unlink" onClick={() => setConfirmUnlink(true)}>
              Desvincular esta TV
            </Button>
          )}
        </div>
        {confirmUnlink && (
          <p className="settings__note">
            Esta TV para de sincronizar e mantém o que já tem. O histórico continua no código, para as outras TVs.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="settings__block" data-scroll-anchor="top">
      <h2 className="settings__title">Sincronizar histórico entre TVs</h2>
      <p className="settings__note">
        Continuar assistindo e os episódios assistidos iguais em todas as TVs da casa, sem conta nem e-mail: só um
        código de 8 números.
      </p>
      {error && (
        <p className="settings__error">
          {error.status === 'locked'
            ? `Muitos códigos criados por esta rede. Tente de novo em ${error.minutes} min.`
            : 'Sem conexão com o servidor. Confira a internet e tente de novo.'}
        </p>
      )}
      <div className="settings__options">
        <Button variant="pill" icon="plus" id="house-create" onClick={create}>
          {creating ? 'Criando…' : 'Criar código'}
        </Button>
        <Button variant="pill" id="house-link" onClick={() => navigate('/settings/house')}>
          Já tenho um código
        </Button>
      </div>
    </section>
  );
}

export default function Settings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(getSettings);
  const [sources, setSources] = useState(listSources);
  const [speed, setSpeed] = useState<SpeedReading | null>(lastSpeed);
  const [testing, setTesting] = useState(false);
  const [adding, setAdding] = useState('');
  const [addError, setAddError] = useState<{ url: string; message: string } | null>(null);

  usePageFocus(true);

  // Na primeira abertura as fontes padrão podem chegar com a tela já aberta.
  useEffect(() => {
    let alive = true;
    installDefaultSources().then(() => alive && setSources(listSources()));
    return () => {
      alive = false;
    };
  }, []);

  const chooseAudio = (audio: AudioLanguage) => setSettings(saveSettings({ audio }));

  const remove = (base: string) => {
    removeSource(base);
    setSources(listSources());
  };

  // Fonte da lista (src/sources.json): instala com um clique.
  const add = (source: ListedSource) => {
    if (adding) return;
    setAdding(source.url);
    setAddError(null);
    installSource(source.url).then(
      () => {
        setSources(listSources());
        setAdding('');
      },
      (err) => {
        setAddError({
          url: source.url,
          message: err instanceof SourceError ? INSTALL_ERRORS[err.code] : INSTALL_ERRORS.unreachable,
        });
        setAdding('');
      },
    );
  };

  const available = listedSources().filter((s) => !isInstalled(s, sources));

  const test = () => {
    setTesting(true);
    measureSpeed().then((reading) => {
      setSpeed(reading);
      setTesting(false);
    });
  };

  return (
    <div className="page settings" data-focus-main="">
      <ScrollArea>
        <div className="page-head" data-scroll-anchor="top">
          <h1 className="page-head__title display">Configurações</h1>
        </div>

        <HouseSync />

        <section className="settings__block" data-scroll-anchor="200">
          <h2 className="settings__title">Fontes de vídeo</h2>
          <p className="settings__note">Addons que fornecem o vídeo dos títulos.</p>
          {sources.length === 0 && <p className="settings__empty">Nenhuma fonte instalada.</p>}
          <div className="settings__sources">
            {sources.map((s) => (
              <SourceRow
                key={s.base}
                id={`remove:${s.base}`}
                name={s.name}
                icon="check"
                action="Remover"
                onSelect={() => remove(s.base)}
              />
            ))}
            {available.map((s) => (
              <SourceRow
                key={s.url}
                id={`add:${s.url}`}
                name={s.name}
                icon="plus"
                action={adding === s.url ? 'Adicionando…' : 'Adicionar'}
                error={addError && addError.url === s.url ? addError.message : undefined}
                onSelect={() => add(s)}
              />
            ))}
          </div>
          <div className="settings__options">
            <Button variant="pill" icon="plus" id="add-source" onClick={() => navigate('/settings/add-source')}>
              Adicionar por link
            </Button>
          </div>
        </section>

        <section className="settings__block" data-scroll-anchor="200">
          <h2 className="settings__title">Idioma preferido</h2>
          <p className="settings__note">
            O Freeflix toca de preferência a fonte com áudio neste idioma. Sem ela, usa o áudio original e depois o
            inglês. Na lista Fontes do player sempre fica uma opção no idioma original, quando existe.
          </p>
          <div className="settings__options">
            {AUDIO_LANGUAGES.map((a) => (
              <Button
                key={a.id}
                variant="pill"
                id={`audio:${a.id}`}
                icon={a.id === settings.audio ? 'check' : undefined}
                selected={a.id === settings.audio}
                onClick={() => chooseAudio(a.id)}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </section>

        <section className="settings__block" data-scroll-anchor="200">
          <h2 className="settings__title">Rede</h2>
          <p className="settings__note">
            {speed
              ? speed.measured
                ? `Última medição: ${speed.mbps} Mbps. Qualidade escolhida: ${qualityFor(speed.mbps)}.`
                : `O teste não completou; usando ${speed.mbps} Mbps como estimativa (${qualityFor(speed.mbps)}).`
              : 'Ainda não medida. O teste roda sozinho na primeira reprodução.'}
          </p>
          <div className="settings__options">
            <Button variant="pill" id="test-network" onClick={test}>
              {testing ? 'Testando…' : 'Testar agora'}
            </Button>
          </div>
        </section>

        <p className="settings__version">Freeflix {__APP_VERSION__}</p>
      </ScrollArea>
    </div>
  );
}
