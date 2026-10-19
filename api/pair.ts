// Criar a casa pelo QR code da TV.
//   POST { action: "start", device }  (TV)      -> { token }      o QR leva a /parear.html?t=token
//   GET  ?t=&device=                  (TV)      -> { status: "waiting" | "done" | "expired", code? }
//   POST { action: "claim", token }   (celular) -> { code } | 410 expirado
// O celular que abre o link cria a casa e a TV do QR já entra nela; o código
// mostrado no celular serve para as outras TVs.
import { randomBytes, randomInt } from 'node:crypto';
import {
  counters,
  countFailure,
  DEVICE,
  ensureSchema,
  json,
  linkDevice,
  lockedFor,
  preflight,
  readBody,
  sql,
  tooMany,
} from './_lib.js';

/** QR vale por este tempo */
const PAIR_TTL = '15 minutes';
/** QR novos por rede, por hora */
const START_LIMIT = 60;
const TOKEN = /^[a-f0-9]{24}$/;

export const OPTIONS = preflight;

async function newHouse(): Promise<string | null> {
  // 6 dígitos sorteados; se já existir, sorteia de novo
  for (let i = 0; i < 20; i++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const rows = (await sql`insert into houses (code) values (${code}) on conflict do nothing returning code`) as {
      code: string;
    }[];
    if (rows.length) return code;
  }
  return null;
}

export async function GET(req: Request) {
  await ensureSchema();
  const params = new URL(req.url).searchParams;
  const token = params.get('t') || '';
  const device = params.get('device') || '';
  if (!TOKEN.test(token) || !DEVICE.test(device)) return json({ error: 'bad-request' }, 400);
  const rows = (await sql`
    select house_code, created_at > now() - ${PAIR_TTL}::interval as fresh
    from pairings where token = ${token} and device_id = ${device}
  `) as { house_code: string | null; fresh: boolean }[];
  if (!rows.length) return json({ status: 'expired' });
  if (rows[0].house_code) return json({ status: 'done', code: rows[0].house_code });
  return json({ status: rows[0].fresh ? 'waiting' : 'expired' });
}

export async function POST(req: Request) {
  await ensureSchema();
  const body = await readBody(req);

  if (body.action === 'start') {
    if (typeof body.device !== 'string' || !DEVICE.test(body.device)) return json({ error: 'bad-request' }, 400);
    const limit = counters(req, undefined, 'pair:').map((c) => ({ ...c, limit: START_LIMIT }));
    const wait = await lockedFor(limit);
    if (wait) return tooMany(wait);
    await countFailure(limit, '1 hour');
    const token = randomBytes(12).toString('hex');
    await sql`delete from pairings where created_at < now() - ${PAIR_TTL}::interval`;
    await sql`insert into pairings (token, device_id) values (${token}, ${body.device})`;
    return json({ token });
  }

  if (body.action === 'claim') {
    const token = typeof body.token === 'string' ? body.token : '';
    if (!TOKEN.test(token)) return json({ error: 'bad-request' }, 400);
    const rows = (await sql`
      select device_id, house_code, created_at > now() - ${PAIR_TTL}::interval as fresh
      from pairings where token = ${token}
    `) as { device_id: string; house_code: string | null; fresh: boolean }[];
    if (!rows.length || (!rows[0].fresh && !rows[0].house_code)) return json({ error: 'expired' }, 410);
    // celular recarregou a página: o mesmo código
    if (rows[0].house_code) return json({ code: rows[0].house_code });
    const code = await newHouse();
    if (!code) return json({ error: 'busy' }, 503);
    // duas aberturas ao mesmo tempo: fica a casa de quem gravou primeiro
    const won = (await sql`
      update pairings set house_code = ${code} where token = ${token} and house_code is null returning token
    `) as unknown[];
    if (!won.length) {
      await sql`delete from houses where code = ${code}`;
      const again = (await sql`select house_code from pairings where token = ${token}`) as { house_code: string }[];
      return json({ code: again[0].house_code });
    }
    await linkDevice(rows[0].device_id, code);
    return json({ code });
  }

  return json({ error: 'bad-request' }, 400);
}
