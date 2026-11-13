import { getJson } from '../data/addonClient';

// Quais fontes estão no ar. Ao abrir o app, cada fonte instalada responde ao
// manifest; a que não responde (fora do ar, domínio morto, erro do servidor)
// fica de fora das buscas por um tempo, e quem procura um vídeo não espera por
// ela. Passado esse tempo, ela é testada de novo em segundo plano e volta
// sozinha se tiver voltado. Uma busca de vídeo que falha por rede também tira
// a fonte; demora (timeout) e erro do servidor para um título não.

/** tempo para o manifest responder no teste */
const PROBE_TIMEOUT_MS = 8000;
/** quanto tempo uma fonte fora fica sem ser consultada antes do novo teste */
const DOWN_FOR_MS = 5 * 60 * 1000;

/** endereço base → momento em que foi vista fora */
const down: Record<string, number> = {};
const probing: Record<string, Promise<void>> = {};

/**
 * Testa a fonte (uma vez por vez). Resposta qualquer do manifest = no ar.
 * Quem chama não precisa esperar: o resultado só vale para as próximas buscas.
 */
export function probeSource(base: string): Promise<void> {
  const running = probing[base];
  if (running) return running;
  const done = getJson<unknown>(`${base}/manifest.json`, PROBE_TIMEOUT_MS).then(
    () => markUp(base),
    () => markDown(base),
  );
  probing[base] = done.then(() => {
    delete probing[base];
  });
  return probing[base];
}

/** Testa todas as fontes ao mesmo tempo. */
export function probeSources(bases: string[]): Promise<void> {
  return Promise.all(bases.map(probeSource)).then(() => undefined);
}

export function markDown(base: string) {
  down[base] = Date.now();
}

export function markUp(base: string) {
  delete down[base];
}

/**
 * A fonte está fora agora? Passado DOWN_FOR_MS, dispara o novo teste e
 * continua de fora até ele dizer que voltou.
 */
export function isDown(base: string): boolean {
  const at = down[base];
  if (at == null) return false;
  if (Date.now() - at >= DOWN_FOR_MS) {
    down[base] = Date.now();
    probeSource(base);
  }
  return true;
}

/**
 * Deixa de fora as fontes fora do ar. Se todas estiverem fora (a rede da TV
 * caiu e voltou, por exemplo), pergunta a todas: melhor tentar do que ficar
 * sem nada.
 */
export function onlyUp<T extends { base: string }>(sources: T[]): T[] {
  const up = sources.filter((s) => !isDown(s.base));
  return up.length ? up : sources;
}

/**
 * Erro de busca que mostra a fonte fora: só rede (sem resposta nenhuma). Erro
 * do servidor (5xx) na busca de um título não conta: o Veyra responde 503
 * ("get_vod_info indisponível") para alguns títulos e funciona para os outros;
 * tirar a fonte de todas as buscas por 5 min fazia o título seguinte perder a
 * fonte mais rápida.
 */
export function showsDown(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  if (message === 'timeout' || /abort/i.test(message)) return false;
  return !/^http \d+/.test(message);
}
