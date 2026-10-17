// Base das funções da sincronização entre TVs (código da casa). Arquivos que
// começam com "_" não viram rota na Vercel.
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
export const sql = neon(url);

let schema: Promise<unknown> | null = null;

/** Cria as tabelas na primeira chamada de cada instância; depois é instantâneo. */
export function ensureSchema() {
  if (!schema) {
    schema = (async () => {
      await sql`create table if not exists houses (
        code text primary key check (code ~ '^[0-9]{8}$'),
        created_at timestamptz not null default now()
      )`;
      await sql`create table if not exists progress (
        house_code text not null references houses(code) on delete cascade,
        content_id text not null,
        title_id text not null,
        season int,
        episode int,
        position_seconds int not null,
        duration_seconds int not null,
        finished boolean not null default false,
        title jsonb,
        updated_at timestamptz not null,
        primary key (house_code, content_id)
      )`;
      await sql`create table if not exists history (
        house_code text not null references houses(code) on delete cascade,
        content_id text not null,
        title_id text not null,
        season int,
        episode int,
        title jsonb,
        watched_at timestamptz not null,
        finished boolean not null default false,
        primary key (house_code, content_id)
      )`;
      await sql`create table if not exists code_attempts (
        key text primary key,
        failures int not null default 0,
        locked_until timestamptz,
        updated_at timestamptz not null default now()
      )`;
    })();
    schema.catch(() => (schema = null));
  }
  return schema;
}

// O app da TV roda de file:// (origem "null"): a API responde a qualquer origem.
// Sem segredo nenhum aqui; quem tem o código da casa é que lê e grava.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...headers },
  });
}

export const preflight = () => new Response(null, { status: 204, headers: CORS });

/** Corpo em JSON. O app manda como text/plain para não precisar de preflight nas TVs antigas. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (text.length > 200_000) return {};
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const CODE = /^[0-9]{8}$/;
const DEVICE = /^[A-Za-z0-9-]{8,64}$/;

// ---------- Tentativas ----------

/** 5 códigos errados seguidos travam o aparelho por 10 min. */
const DEVICE_LIMIT = 5;
/** Pela rede da casa (IP) a margem é maior: várias TVs dividem o mesmo endereço. */
const IP_LIMIT = 20;
const LOCK = '10 minutes';
/** erro de muito tempo atrás não conta como "seguido" */
const STALE = '1 hour';

interface Counter {
  key: string;
  limit: number;
}

function clientIp(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0].trim() : '') || req.headers.get('x-real-ip') || 'unknown';
}

/** Quem está tentando: o aparelho (id que o app gera) e a rede de onde veio. */
export function counters(req: Request, device: unknown, prefix = ''): Counter[] {
  const list: Counter[] = [{ key: `${prefix}ip:${clientIp(req)}`, limit: IP_LIMIT }];
  if (typeof device === 'string' && DEVICE.test(device)) {
    list.push({ key: `${prefix}dev:${device}`, limit: DEVICE_LIMIT });
  }
  return list;
}

/** Segundos que ainda faltam de bloqueio (0 se livre). */
export async function lockedFor(list: Counter[]): Promise<number> {
  const rows = (await sql`
    select ceil(extract(epoch from max(locked_until) - now()))::int as seconds
    from code_attempts
    where key = any(${list.map((c) => c.key)}) and locked_until > now()
  `) as { seconds: number | null }[];
  return rows[0] && rows[0].seconds ? Math.max(1, rows[0].seconds) : 0;
}

/** Conta uma tentativa errada. Devolve quantas restam ao aparelho e, se travou, por quanto tempo. */
export async function countFailure(list: Counter[], lock = LOCK) {
  let left = Infinity;
  let locked = 0;
  for (const c of list) {
    const rows = (await sql`
      insert into code_attempts as a (key, failures, locked_until, updated_at)
      values (${c.key}, 1, case when 1 >= ${c.limit} then now() + ${lock}::interval end, now())
      on conflict (key) do update set
        failures = case
          when a.locked_until <= now() or a.updated_at < now() - ${STALE}::interval then 1
          else a.failures + 1 end,
        locked_until = case
          when (case
            when a.locked_until <= now() or a.updated_at < now() - ${STALE}::interval then 1
            else a.failures + 1 end) >= ${c.limit} then now() + ${lock}::interval
          else null end,
        updated_at = now()
      returning failures, ceil(extract(epoch from locked_until - now()))::int as seconds
    `) as { failures: number; seconds: number | null }[];
    const row = rows[0];
    if (row.seconds && row.seconds > 0) locked = Math.max(locked, row.seconds);
    left = Math.min(left, Math.max(0, c.limit - row.failures));
  }
  return { left: left === Infinity ? 0 : left, locked };
}

/** Acertou: a sequência de erros recomeça. */
export async function clearFailures(list: Counter[]) {
  await sql`delete from code_attempts where key = any(${list.map((c) => c.key)})`;
}

export const tooMany = (seconds: number) =>
  json({ error: 'locked', retryAfter: seconds }, 429, { 'Retry-After': String(seconds) });

/**
 * Confere o código da casa respeitando o limite de tentativas. Código errado
 * conta como tentativa em qualquer rota, para ninguém adivinhar pela sincronização.
 * Devolve a resposta de erro, ou null quando o código existe.
 */
export async function checkHouse(req: Request, code: unknown, device: unknown): Promise<Response | null> {
  const list = counters(req, device);
  const wait = await lockedFor(list);
  if (wait) return tooMany(wait);
  if (typeof code === 'string' && CODE.test(code)) {
    const found = (await sql`select 1 from houses where code = ${code}`) as unknown[];
    if (found.length) return null;
  }
  const { left, locked } = await countFailure(list);
  return locked ? tooMany(locked) : json({ error: 'not-found', left }, 404);
}
