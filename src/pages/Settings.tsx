import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { ScrollArea } from '../components/ScrollArea';
import { Icon, type IconName } from '../components/Icon';
import { useFocusable, usePageFocus } from '../focus/useFocusable';
import { AUDIO_LANGUAGES, CATALOGS, getSettings, saveSettings, type AudioLanguage, type CatalogId } from '../settings';
import { lastSpeed, measureSpeed, type SpeedReading } from '../streams/network';
import { resolutionCap } from '../streams/rank';
import {
  INSTALL_ERRORS,
  installSource,
  isInstalled,
  LISTED_SOURCES,
  listSources,
  removeSource,
  SourceError,
  type ListedSource,
} from '../streams/sources';

/** quantas fontes da lista entram sozinhas ao ativar o catálogo completo */
const AUTO_SOURCES = 2;

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

export default function Settings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState(getSettings);
  const [sources, setSources] = useState(listSources);
  const [speed, setSpeed] = useState<SpeedReading | null>(lastSpeed);
  const [testing, setTesting] = useState(false);
  const [switching, setSwitching] = useState<CatalogId | ''>('');
  const [adding, setAdding] = useState('');
  const [addError, setAddError] = useState<{ url: string; message: string } | null>(null);

  usePageFocus(true);

  const chooseCatalog = (catalog: CatalogId) => {
    if (catalog === settings.catalog || switching) return;
    setSwitching(catalog);
    // O catálogo completo depende de fontes: ao ativá-lo, as primeiras da lista
    // (src/sources.json) já entram junto. Falha em uma delas não impede a troca.
    const wanted =
      catalog === 'freeflix'
        ? LISTED_SOURCES.slice(0, AUTO_SOURCES).filter((s) => !isInstalled(s, listSources()))
        : [];
    wanted
      .reduce((done, s) => done.then(() => installSource(s.url).then(() => undefined, () => undefined)), Promise.resolve())
      .then(() => {
        saveSettings({ catalog });
        // O catálogo é resolvido na partida do app: recarrega, na mesma tela, já com o novo.
        window.location.reload();
      });
  };

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

  const available = LISTED_SOURCES.filter((s) => !isInstalled(s, sources));

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

        <section className="settings__block" data-scroll-anchor="top">
          <h2 className="settings__title">Catálogo</h2>
          <p className="settings__note">
            De onde vêm os títulos, pôsteres e sinopses. O catálogo completo segue o idioma do aparelho. Trocar reinicia
            o app.
          </p>
          <div className="settings__options">
            {CATALOGS.map((c) => (
              <Button
                key={c.id}
                variant="pill"
                id={`catalog:${c.id}`}
                autoFocus={c.id === settings.catalog}
                icon={c.id === settings.catalog ? 'check' : undefined}
                selected={c.id === settings.catalog}
                onClick={() => chooseCatalog(c.id)}
              >
                {switching === c.id ? 'Ativando…' : c.label}
              </Button>
            ))}
          </div>
        </section>

        {/* Os clássicos já trazem o próprio vídeo; fontes só servem ao catálogo completo. */}
        {settings.catalog === 'freeflix' && (
          <section className="settings__block" data-scroll-anchor="200">
            <h2 className="settings__title">Fontes de vídeo</h2>
            <p className="settings__note">
              Addons que fornecem o vídeo dos títulos.
            </p>
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
        )}

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
      </ScrollArea>
    </div>
  );
}
