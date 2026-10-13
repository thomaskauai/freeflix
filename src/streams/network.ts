// Teste simples de rede: baixa um arquivo de tamanho conhecido e mede a taxa.
// Serve para decidir a resolução; não é um medidor de precisão.

const TEST_BYTES = 5_000_000;
const TEST_URL = `https://speed.cloudflare.com/__down?bytes=${TEST_BYTES}`;
const TEST_TIMEOUT_MS = 8000;
const FRESH_FOR_MS = 30 * 60 * 1000;
/** usado quando o teste falha: conservador o bastante para não escolher 4K */
export const FALLBACK_MBPS = 10;
const KEY = 'freeflix.network';

export interface SpeedReading {
  mbps: number;
  at: number;
  /** false quando o teste falhou e o valor é o padrão */
  measured: boolean;
}

export function lastSpeed(): SpeedReading | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || 'null') as SpeedReading | null;
    return saved && typeof saved.mbps === 'number' ? saved : null;
  } catch {
    return null;
  }
}

export async function measureSpeed(): Promise<SpeedReading> {
  const started = Date.now();
  let received = 0;
  let reading: SpeedReading;
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = window.setTimeout(() => controller && controller.abort(), TEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${TEST_URL}&t=${started}`, {
        cache: 'no-store',
        signal: controller ? controller.signal : undefined,
      });
      const reader = res.body && res.body.getReader ? res.body.getReader() : null;
      if (reader) {
        // lê em pedaços: se o tempo acabar no meio, o que chegou ainda vale como medida
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          received += chunk.value.length;
        }
      } else {
        received = (await res.arrayBuffer()).byteLength;
      }
    } finally {
      window.clearTimeout(timer);
    }
  } catch {
    /* rede lenta ou bloqueada: usa o que chegou até aqui */
  }
  const seconds = (Date.now() - started) / 1000;
  if (received > 200_000 && seconds > 0) {
    reading = { mbps: Math.round(((received * 8) / seconds / 1e6) * 10) / 10, at: Date.now(), measured: true };
  } else {
    reading = { mbps: FALLBACK_MBPS, at: Date.now(), measured: false };
  }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(reading));
  } catch {
    /* sem persistência nesta sessão */
  }
  return reading;
}

/** Medida recente, se houver; senão mede agora. */
export async function getSpeed(): Promise<SpeedReading> {
  const last = lastSpeed();
  if (last && Date.now() - last.at < FRESH_FOR_MS) return last;
  return measureSpeed();
}
