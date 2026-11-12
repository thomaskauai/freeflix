// Catálogo dos streamings no Brasil, lido do JustWatch: completo, em português,
// já no formato de catálogo dos addons ({ metas }). Os streamings que o catálogo
// principal (Nuvio) não tem vêm daqui.
//   GET ?list=series&service=&page= -> séries do streaming, 20 por página
//   GET ?list=movies&service=&page= -> filmes do streaming, 20 por página
//   GET ?list=novelas      -> novelas brasileiras do Globoplay (todas, das mais vistas para as menos)
//   GET ?list=series-br    -> séries brasileiras do Globoplay que não são novela (todas)
//   GET ?list=movies-br&page= -> filmes brasileiros do Globoplay, 20 por página
//   GET ?list=anime-ids    -> ids IMDb de todos os animes (séries e filmes), para o app esconder
//   GET ?list=cinema-ids   -> ids IMDb dos filmes que só passam no cinema (no mundo), para o app esconder
// service: nfx (Netflix), mxx (HBO Max), atp (Apple TV+), pmp (Paramount+), gop (Globoplay, o padrão), cru (Crunchyroll).
// A API do JustWatch só libera CORS para localhost; o servidor busca por elas
// (as listas em si estão em api/_justwatch.ts, que o app da TV também usa).
import { json, preflight } from "./_lib.js";

import { ask, BATCH, cursor, GLOBOPLAY, listMetas, SERVICES } from "./_justwatch.js";

export const OPTIONS = preflight;

/**
 * Anime: animação do Japão, da China ou da Coreia, sem os EUA na produção
 * (Super Mario e Batman coproduzidos lá são de fora; Cyberpunk, Japão e
 * Polônia, é anime). O JustWatch não passa de ~1900 por filtro, então as
 * séries vêm fatiadas por ano.
 */
const ANIME_COUNTRIES = ["JP", "CN", "KR", "TW"];
const ANIME_SLICES: {
  kind: "SHOW" | "MOVIE";
  years?: { min?: number; max?: number };
}[] = [
  { kind: "SHOW", years: { max: 2009 } },
  { kind: "SHOW", years: { min: 2010, max: 2017 } },
  { kind: "SHOW", years: { min: 2018, max: 2021 } },
  { kind: "SHOW", years: { min: 2022 } },
  { kind: "MOVIE" },
];
const ANIME_QUERY = `query Anime($first: Int!, $after: String, $filter: TitleFilter) {
  popularTitles(country: BR, first: $first, after: $after, filter: $filter) {
    edges { node { content(country: BR, language: "pt") { productionCountries externalIds { imdbId } } } }
  }
}`;

interface AnimeNode {
  content: {
    productionCountries: string[] | null;
    externalIds: { imdbId: string | null };
  };
}

async function animePage(
  slice: (typeof ANIME_SLICES)[number],
  offset: number,
): Promise<AnimeNode[]> {
  const filter = {
    objectTypes: [slice.kind],
    genres: ["ani"],
    productionCountries: ANIME_COUNTRIES,
    ...(slice.years ? { releaseYear: slice.years } : {}),
  };
  const after = offset ? cursor(offset) : "";
  const res = await ask(
    JSON.stringify({
      query: ANIME_QUERY,
      variables: { first: BATCH, after, filter },
    }),
  );
  const body = (await res.json()) as {
    data?: { popularTitles: { edges: { node: AnimeNode }[] } };
  };
  return body.data ? body.data.popularTitles.edges.map((e) => e.node) : [];
}

/** Todos os animes: cada fatia em pedidos de 100, quatro por vez, até acabar. */
async function animeIds(): Promise<string[]> {
  const ids: Record<string, boolean> = {};
  await Promise.all(
    ANIME_SLICES.map(async (slice) => {
      for (let start = 0; start < 2000; start += 4 * BATCH) {
        const chunk = await Promise.all(
          [0, 1, 2, 3].map((i) => animePage(slice, start + i * BATCH)),
        );
        chunk.forEach((nodes) =>
          nodes.forEach((n) => {
            const id = n.content.externalIds.imdbId;
            if (id && (n.content.productionCountries ?? []).indexOf("US") < 0)
              ids[id] = true;
          }),
        );
        if (chunk[chunk.length - 1].length < BATCH) break;
      }
    }),
  );
  return Object.keys(ids);
}

/**
 * Países onde as cópias digitais costumam sair primeiro. "Só no cinema" vale
 * para o mundo: estreou aqui, mas já está à venda nos EUA, existe WEB-DL.
 */
const CINEMA_COUNTRIES = [
  "BR",
  "US",
  "GB",
  "CA",
  "AU",
  "IN",
  "DE",
  "FR",
  "ES",
  "IT",
  "MX",
  "JP",
  "KR",
  "NL",
];
/** os filmes em cartaz saem destas listas */
const CINEMA_FROM = ["BR", "US"];
const DISC = ["DVD", "BLURAY", "BLURAY_4K"];

const CINEMA_QUERY = `query Cinema($country: Country!, $first: Int!, $after: String, $filter: TitleFilter) {
  popularTitles(country: $country, first: $first, after: $after, filter: $filter) {
    edges { node {
      content(country: BR, language: "pt") { externalIds { imdbId } }
      ${CINEMA_COUNTRIES.map((c) => `${c}: offers(country: ${c}, platform: WEB) { monetizationType presentationType availableFromTime }`).join("\n      ")}
    } }
  }
}`;

interface CinemaOffer {
  monetizationType: string;
  presentationType: string;
  availableFromTime: string | null;
}

type CinemaNode = {
  content: { externalIds: { imdbId: string | null } };
} & Record<string, CinemaOffer[]>;

/**
 * Oferta que é cópia digital já disponível: assinatura ou grátis; aluguel ou
 * compra só com data de início já passada (sem data é pré-venda, como a do
 * Fandango na semana da estreia). DVD e Blu-ray não contam: são pré-venda de disco.
 */
const isDigital = (o: CinemaOffer, now: string) =>
  o.monetizationType !== "CINEMA" &&
  DISC.indexOf(o.presentationType) < 0 &&
  ((o.monetizationType !== "RENT" && o.monetizationType !== "BUY") ||
    (!!o.availableFromTime && o.availableFromTime <= now));

async function cinemaPage(
  country: string,
  offset: number,
): Promise<CinemaNode[]> {
  const after = offset ? cursor(offset) : "";
  const res = await ask(
    JSON.stringify({
      query: CINEMA_QUERY,
      variables: {
        country,
        first: BATCH,
        after,
        filter: { objectTypes: ["MOVIE"], monetizationTypes: ["CINEMA"] },
      },
    }),
  );
  const body = (await res.json()) as {
    data?: { popularTitles: { edges: { node: CinemaNode }[] } };
  };
  return body.data ? body.data.popularTitles.edges.map((e) => e.node) : [];
}

/**
 * Filmes em cartaz (no Brasil ou nos EUA) sem cópia digital disponível em
 * nenhum dos países: o que existe deles é gravação de cinema. Pedidos de 100,
 * cinco por vez, até acabar.
 */
async function cinemaIds(): Promise<string[]> {
  const now = new Date().toISOString();
  const ids: Record<string, boolean> = {};
  const digital: Record<string, boolean> = {};
  await Promise.all(
    CINEMA_FROM.map(async (country) => {
      for (let start = 0; start < 3000; start += 5 * BATCH) {
        const chunk = await Promise.all(
          [0, 1, 2, 3, 4].map((i) => cinemaPage(country, start + i * BATCH)),
        );
        chunk.forEach((nodes) =>
          nodes.forEach((n) => {
            const id = n.content.externalIds.imdbId;
            if (!id) return;
            ids[id] = true;
            if (
              CINEMA_COUNTRIES.some((c) =>
                (n[c] || []).some((o) => isDigital(o, now)),
              )
            )
              digital[id] = true;
          }),
        );
        if (chunk[chunk.length - 1].length < BATCH) break;
      }
    }),
  );
  return Object.keys(ids).filter((id) => !digital[id]);
}

/** Última lista boa nesta instância da função: JustWatch fora do ar não deixa o app sem filtro. */
const good: Record<string, string[]> = {};
async function lastGood(
  name: string,
  load: () => Promise<string[]>,
): Promise<string[]> {
  try {
    const ids = await load();
    good[name] = ids;
    return ids;
  } catch (e) {
    if (good[name]) return good[name];
    throw e;
  }
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const list = params.get("list");
  const page = Math.max(0, Math.min(200, Number(params.get("page")) || 0));
  const service = params.get("service") || GLOBOPLAY;
  if (SERVICES.indexOf(service) < 0) return json({ error: "bad-request" }, 400);
  try {
    if (list === "anime-ids") {
      // muda devagar: um dia no CDN, e mais uma semana servindo a antiga enquanto renova
      return json({ ids: await lastGood("anime", animeIds) }, 200, {
        "Cache-Control":
          "public, s-maxage=86400, stale-while-revalidate=604800",
      });
    }
    if (list === "cinema-ids") {
      // sai do cinema para o streaming de um dia para o outro: seis horas no CDN
      return json({ ids: await lastGood("cinema", cinemaIds) }, 200, {
        "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
      });
    }
    const found = list ? await listMetas(list, service, page) : null;
    if (!found) return json({ error: "bad-request" }, 400);
    // o catálogo muda devagar: seis horas no CDN, e mais um dia servindo o antigo enquanto renova
    return json({ metas: found }, 200, {
      "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
    });
  } catch (e) {
    console.error("justwatch", list, e instanceof Error ? e.message : e);
    return json({ error: "upstream" }, 502);
  }
}
