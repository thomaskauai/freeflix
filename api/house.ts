// Código da casa: criar um novo ou vincular esta TV a um existente.
//   POST { action: "create", device }        -> { code }
//   POST { action: "link", code, device }    -> { code } | 404 { left } | 429 { retryAfter }
import { randomInt } from 'node:crypto';
import {
  checkHouse,
  clearFailures,
  counters,
  countFailure,
  ensureSchema,
  json,
  lockedFor,
  preflight,
  readBody,
  sql,
  tooMany,
} from './_lib.js';

/** códigos novos por rede, por hora: ninguém enche o banco de casas vazias */
const CREATE_LIMIT = 20;

export const OPTIONS = preflight;

export async function POST(req: Request) {
  await ensureSchema();
  const body = await readBody(req);

  if (body.action === 'create') {
    const limit = counters(req, undefined, 'create:').map((c) => ({ ...c, limit: CREATE_LIMIT }));
    const wait = await lockedFor(limit);
    if (wait) return tooMany(wait);
    await countFailure(limit, '1 hour');
    // 8 dígitos sorteados; se já existir, sorteia de novo
    for (let i = 0; i < 10; i++) {
      const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
      const rows = (await sql`insert into houses (code) values (${code}) on conflict do nothing returning code`) as {
        code: string;
      }[];
      if (rows.length) return json({ code });
    }
    return json({ error: 'busy' }, 503);
  }

  if (body.action === 'link') {
    const refused = await checkHouse(req, body.code, body.device);
    if (refused) return refused;
    // só o aparelho recomeça a contagem: a da rede vale até esfriar, senão um
    // código válido conhecido serviria para zerá-la entre chutes
    await clearFailures(counters(req, body.device).filter((c) => c.key.indexOf('ip:') !== 0));
    return json({ code: body.code });
  }

  return json({ error: 'bad-request' }, 400);
}
