// Posições e histórico de uma casa.
//   GET  ?code=&device=                          -> { progress: [...], history: [...] }
//   POST { code, device, progress: [], history: [] } -> { saved }
//   POST { action: "remove", code, device, titles: [] | all: true } -> { removed }
// Em conflito vale o registro com updated_at mais recente; posição igual à
// guardada não grava nada. Título apagado deixa marca em "removed": o que
// chegar com horário de antes dela não volta.
import { checkHouse, ensureSchema, json, preflight, readBody, sql } from './_lib.js';

/** linhas por envio e por leitura */
const MAX_WRITE = 200;
const MAX_READ = 1000;
const CONTENT = /^[A-Za-z0-9:._-]{1,120}$/;

export const OPTIONS = preflight;

export async function GET(req: Request) {
  await ensureSchema();
  const params = new URL(req.url).searchParams;
  const code = params.get('code');
  const refused = await checkHouse(req, code, params.get('device'));
  if (refused) return refused;
  const [progress, history, removed] = await Promise.all([
    sql`
      select content_id, title_id, season, episode, position_seconds, duration_seconds, finished, title,
             updated_at
      from progress where house_code = ${code}
      order by updated_at desc limit ${MAX_READ}
    `,
    sql`
      select content_id, title_id, season, episode, title, watched_at, finished
      from history where house_code = ${code}
      order by watched_at desc limit ${MAX_READ}
    `,
    sql`
      select title_id, removed_at from removed where house_code = ${code}
      order by removed_at desc limit ${MAX_READ}
    `,
  ]);
  return json({ progress, history, removed });
}

const int = (value: unknown, max = 1_000_000) =>
  typeof value === 'number' && isFinite(value) ? Math.max(0, Math.min(max, Math.round(value))) : null;

/** Horário do aparelho, nunca no futuro: relógio adiantado da TV não ganharia todos os conflitos. */
function when(value: unknown): string {
  const t = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return new Date(isFinite(t) ? Math.min(t, Date.now()) : Date.now()).toISOString();
}

/** Só o que o app precisa para desenhar o cartão do título (nome, imagens, ano, imagem do episódio). */
function snapshot(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const text = (s: unknown) => (typeof s === 'string' ? s.slice(0, 500) : undefined);
  if (typeof v.id !== 'string' || typeof v.title !== 'string') return null;
  return JSON.stringify({
    id: text(v.id),
    type: v.type === 'series' ? 'series' : 'movie',
    title: text(v.title),
    poster: text(v.poster),
    backdrop: text(v.backdrop),
    logo: text(v.logo),
    still: text(v.still),
    year: int(v.year, 3000) ?? undefined,
  });
}

interface Row {
  content: string;
  titleId: string;
  season: number | null;
  episode: number | null;
}

function rowOf(value: unknown): (Row & { raw: Record<string, unknown> }) | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.content_id !== 'string' || !CONTENT.test(raw.content_id)) return null;
  if (typeof raw.title_id !== 'string' || !CONTENT.test(raw.title_id)) return null;
  return {
    raw,
    content: raw.content_id,
    titleId: raw.title_id,
    season: int(raw.season, 1000),
    episode: int(raw.episode, 10000),
  };
}

export async function POST(req: Request) {
  await ensureSchema();
  const body = await readBody(req);
  const refused = await checkHouse(req, body.code, body.device);
  if (refused) return refused;
  const code = body.code as string;

  if (body.action === 'remove') return remove(code, body);

  const progress = (Array.isArray(body.progress) ? body.progress : []).slice(0, MAX_WRITE).map(rowOf);
  const history = (Array.isArray(body.history) ? body.history : []).slice(0, MAX_WRITE).map(rowOf);

  const writes = [
    ...progress.flatMap((r) => {
      const position = r && int(r.raw.position_seconds);
      const duration = r && int(r.raw.duration_seconds);
      if (!r || position == null || duration == null) return [];
      return [
        sql`
          insert into progress as p (house_code, content_id, title_id, season, episode, position_seconds,
                                     duration_seconds, finished, title, updated_at)
          select ${code}, ${r.content}, ${r.titleId}, ${r.season}, ${r.episode}, ${position}, ${duration},
                 ${r.raw.finished === true}, ${snapshot(r.raw.title)}::jsonb, ${when(r.raw.updated_at)}::timestamptz
          where not exists (
            select 1 from removed where house_code = ${code} and title_id = ${r.titleId}
              and removed_at >= ${when(r.raw.updated_at)}::timestamptz
          )
          on conflict (house_code, content_id) do update set
            title_id = excluded.title_id,
            season = excluded.season,
            episode = excluded.episode,
            position_seconds = excluded.position_seconds,
            duration_seconds = excluded.duration_seconds,
            finished = excluded.finished,
            title = coalesce(excluded.title, p.title),
            updated_at = excluded.updated_at
          where p.updated_at < excluded.updated_at
            and (p.position_seconds <> excluded.position_seconds
                 or p.duration_seconds <> excluded.duration_seconds
                 or p.finished <> excluded.finished)
        `,
      ];
    }),
    ...history.flatMap((r) =>
      r
        ? [
            sql`
              insert into history as h (house_code, content_id, title_id, season, episode, title, watched_at, finished)
              select ${code}, ${r.content}, ${r.titleId}, ${r.season}, ${r.episode},
                     ${snapshot(r.raw.title)}::jsonb, ${when(r.raw.watched_at)}::timestamptz, ${r.raw.finished === true}
              where not exists (
                select 1 from removed where house_code = ${code} and title_id = ${r.titleId}
                  and removed_at >= ${when(r.raw.watched_at)}::timestamptz
              )
              on conflict (house_code, content_id) do update set
                watched_at = greatest(h.watched_at, excluded.watched_at),
                finished = h.finished or excluded.finished,
                title = coalesce(excluded.title, h.title)
              where excluded.watched_at > h.watched_at or (excluded.finished and not h.finished)
            `,
          ]
        : [],
    ),
  ];
  if (writes.length) await sql.transaction(writes);
  return json({ saved: writes.length });
}

/** Apaga títulos (ou tudo) de Continuar assistindo e do histórico da casa. */
async function remove(code: string, body: Record<string, unknown>) {
  const now = new Date().toISOString();
  let titles: string[];
  if (body.all === true) {
    const rows = (await sql`
      select title_id from history where house_code = ${code}
      union select title_id from progress where house_code = ${code}
    `) as { title_id: string }[];
    titles = rows.map((r) => r.title_id);
  } else {
    titles = (Array.isArray(body.titles) ? body.titles : [])
      .filter((t): t is string => typeof t === 'string' && CONTENT.test(t))
      .slice(0, MAX_WRITE);
  }
  if (!titles.length) return json({ removed: 0 });
  await sql.transaction([
    sql`delete from progress where house_code = ${code} and title_id = any(${titles})`,
    sql`delete from history where house_code = ${code} and title_id = any(${titles})`,
    sql`
      insert into removed (house_code, title_id, removed_at)
      select ${code}, t, ${now}::timestamptz from unnest(${titles}::text[]) as t
      on conflict (house_code, title_id) do update set removed_at = excluded.removed_at
    `,
  ]);
  return json({ removed: titles.length });
}
