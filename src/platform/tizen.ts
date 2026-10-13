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
];

/** Setas, OK e Back chegam sozinhas; teclas de mídia só depois de registradas. */
export function registerMediaKeys() {
  try {
    const device = isTizen() ? window.tizen.tvinputdevice : null;
    if (!device) return;
    if (device.registerKeyBatch) device.registerKeyBatch(MEDIA_KEYS);
    else MEDIA_KEYS.forEach((k) => device.registerKey(k));
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
