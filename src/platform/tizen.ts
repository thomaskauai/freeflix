// Único ponto de acesso a window.tizen. No navegador tudo vira no-op.

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tizen?: any;
  }
}

export const isTizen = (): boolean => typeof window !== 'undefined' && !!window.tizen;

/**
 * TV Tizen antiga (Tizen 5.x, WebView Chromium 63; ex.: sala 2019): camadas
 * com sombra e conteúdo que volta de opacity 0 às vezes não são desenhados.
 * O navegador do Tizen não diz a versão do Chrome no user agent, só a do
 * Tizen ("Tizen 5.0" na sala, "Tizen 9.0" no quarto); o Tizen 6 já usa o 76.
 */
export function isLegacyTizen(): boolean {
  if (!isTizen()) return false;
  const tizen = /Tizen (\d+)/.exec(navigator.userAgent);
  if (tizen) return Number(tizen[1]) < 6;
  const chrome = /Chrome\/(\d+)/.exec(navigator.userAgent);
  return !chrome || Number(chrome[1]) < 76;
}

/** serviço do motor de torrent no config.xml */
const TORRENT_SERVICE = 'FreeFlixTV.Torrent';

/**
 * Sobe o motor de torrent (serviço Node do app). Na TV, ao abrir o app; fora
 * dela, nada. Resolve quando o sistema aceitou (ou recusou) o pedido.
 */
export function startTorrentService(): Promise<boolean> {
  if (!isTizen()) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      window.tizen.application.launchAppControl(
        new window.tizen.ApplicationControl('http://tizen.org/appcontrol/operation/default', null, null, null, null),
        TORRENT_SERVICE,
        () => resolve(true),
        () => resolve(false),
      );
    } catch {
      resolve(false);
    }
  });
}

export function exitApp() {
  try {
    if (isTizen()) window.tizen.application.getCurrentApplication().exit();
  } catch {
    /* fora da TV */
  }
}

const MEDIA_KEYS = [
  'MediaPlayPause',
  'MediaPlay',
  'MediaPause',
  'MediaStop',
  'MediaFastForward',
  'MediaRewind',
  // números do controle: digitar o código da casa
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
];

/** Setas, OK e Back chegam sozinhas; teclas de mídia e números só depois de registradas. */
export function registerMediaKeys() {
  try {
    const device = isTizen() ? window.tizen.tvinputdevice : null;
    if (!device) return;
    // uma por vez: em lote, uma tecla que o modelo não tem derruba todas
    MEDIA_KEYS.forEach((k) => {
      try {
        device.registerKey(k);
      } catch {
        /* tecla que este controle não tem */
      }
    });
    // Códigos reais do aparelho, para conferir contra src/focus/keys.ts.
    console.log(
      '[freeflix] teclas suportadas',
      device
        .getSupportedKeys()
        .filter((k: { name: string }) => MEDIA_KEYS.indexOf(k.name) >= 0 || k.name === 'Back'),
    );
  } catch (err) {
    console.warn('[freeflix] falha ao registrar teclas de mídia', err);
  }
}
