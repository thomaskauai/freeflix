// Código da casa de um aparelho.
//   GET  ?device=                              -> { code } | { code: null }   (a TV voltou: de que casa ela é?)
//   POST { action: "link", code, device }      -> { code } | 404 { left } | 429 { retryAfter }
//   POST { action: "unlink", device }          -> { ok }
// Criar uma casa é pelo QR code (api/pair.ts).
import {
  checkHouse,
  clearFailures,
  counters,
  DEVICE,
  ensureSchema,
  json,
  linkDevice,
  preflight,
  readBody,
  sql,
} from './_lib.js';

export const OPTIONS = preflight;

/** Aparelho reinstalado (ou com os dados apagados) reencontra a casa pelo próprio id. */
export async function GET(req: Request) {
  await ensureSchema();
  const device = new URL(req.url).searchParams.get('device');
  if (!device || !DEVICE.test(device)) return json({ error: 'bad-request' }, 400);
  const rows = (await sql`select house_code from devices where device_id = ${device}`) as { house_code: string }[];
  return json({ code: rows.length ? rows[0].house_code : null });
}

export async function POST(req: Request) {
  await ensureSchema();
  const body = await readBody(req);

  if (body.action === 'link') {
    const refused = await checkHouse(req, body.code, body.device);
    if (refused) return refused;
    // só o aparelho recomeça a contagem: a da rede vale até esfriar, senão um
    // código válido conhecido serviria para zerá-la entre chutes
    await clearFailures(counters(req, body.device).filter((c) => c.key.indexOf('ip:') !== 0));
    await linkDevice(body.device, body.code as string);
    return json({ code: body.code });
  }

  if (body.action === 'unlink') {
    if (typeof body.device !== 'string' || !DEVICE.test(body.device)) return json({ error: 'bad-request' }, 400);
    await sql`delete from devices where device_id = ${body.device}`;
    return json({ ok: true });
  }

  return json({ error: 'bad-request' }, 400);
}
