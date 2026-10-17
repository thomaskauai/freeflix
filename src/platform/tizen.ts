// Único ponto de acesso a window.tizen. No navegador tudo vira no-op.

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tizen?: any;
  }
}

export const isTizen = (): boolean => typeof window !== 'undefined' && !!window.tizen;

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
