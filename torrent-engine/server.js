/* Motor de torrent local do Freeflix.
 *
 * Baixa o torrent e serve o vídeo por HTTP em 127.0.0.1:2710, na ordem em que o
 * player pede (dá para tocar enquanto baixa e pular trechos). O app (TV ou
 * localhost) só fala HTTP com ele; quem fala BitTorrent (TCP/UDP) é este Node.
 *
 * Escrito em JavaScript antigo (var, function, sem class nem =>); na TV vai
 * convertido por build.mjs, junto com as dependências, para o Node 4.4 da sala.
 *
 *   GET /health                         -> { ok, engines }
 *   GET /<hash>/create?tr=..&s=1&e=2    -> abre o torrent; { infoHash, name, files, fileIdx }
 *   GET /<hash>/<idx>                   -> o arquivo, com Range
 *   GET /<hash>/<idx>/stats.json        -> peers, velocidade, quanto baixou
 *   GET /<hash>/remove                  -> para e apaga o que baixou
 *   GET /removeAll
 *   GET /streaming-br?imdb=tt..&q=nome&type=movie|series -> { streaming: true|false|null }
 *
 * Uso no Mac: cd torrent-engine && npm start   (PORT=2710 por padrão)
 */
'use strict';

var http = require('http');
var https = require('https');
var os = require('os');
var path = require('path');
var url = require('url');
var rimraf = require('rimraf');
var torrentStream = require('torrent-stream');

var PORT = Number(process.env.PORT || 2710);
var HOST = process.env.HOST || '127.0.0.1';
/** onde as partes baixadas ficam; tudo é apagado ao remover o torrent */
var STORE = process.env.TORRENT_DIR || path.join(os.tmpdir(), 'freeflix-torrents');
/** metadados (lista de arquivos) que não chegam nesse tempo: desiste */
var METADATA_TIMEOUT_MS = 30000;
/** torrent sem pedido nenhum por esse tempo é parado e apagado */
var IDLE_MS = 10 * 60 * 1000;
/** torrents abertos ao mesmo tempo; o mais antigo sai (espaço da TV) */
var MAX_ENGINES = 2;

/** trackers públicos usados com os do addon: acham peers mais rápido que só o DHT */
var DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://explodie.org:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
];

var VIDEO = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv)$/i;
var MIME = {
  mkv: 'video/x-matroska',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
};

/** hash -> { engine, ready, lastUsed, error } */
var engines = {};

function now() {
  return Date.now();
}

function send(res, status, body, headers) {
  var h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    'Cache-Control': 'no-store',
  };
  var k;
  for (k in headers || {}) h[k] = headers[k];
  if (body !== undefined && typeof body !== 'string' && !Buffer.isBuffer(body)) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  res.writeHead(status, h);
  res.end(body);
}

function trackersFrom(query) {
  var list = [].concat(query.tr || []);
  var out = [];
  list.concat(DEFAULT_TRACKERS).forEach(function (t) {
    // o addon manda "tracker:udp://..." (formato do Stremio)
    var clean = String(t).replace(/^tracker:/, '');
    if (/^(udp|https?):\/\//.test(clean) && out.indexOf(clean) < 0) out.push(clean);
  });
  return out;
}

function remove(hash) {
  var entry = engines[hash];
  if (!entry) return;
  delete engines[hash];
  // apaga o que baixou e depois para (parado antes, ele não apaga mais)
  try {
    entry.engine.remove(false, function () {
      entry.engine.destroy(function () {});
      rimraf(path.join(STORE, hash), function () {});
    });
  } catch (e) {
    try {
      entry.engine.destroy(function () {});
    } catch (_) {
      /* já parado */
    }
  }
}

/** Abre (ou reaproveita) o torrent; chama back(err, entry) quando a lista de arquivos chega. */
function open(hash, trackers, back) {
  var entry = engines[hash];
  if (!entry) {
    // espaço da TV: o torrent mais antigo sai
    var hashes = Object.keys(engines).sort(function (a, b) {
      return engines[a].lastUsed - engines[b].lastUsed;
    });
    while (hashes.length >= MAX_ENGINES) remove(hashes.shift());

    var engine = torrentStream('magnet:?xt=urn:btih:' + hash, {
      path: path.join(STORE, hash),
      trackers: trackers,
      connections: 80,
      uploads: 2,
      verify: true,
      dht: true,
    });
    entry = engines[hash] = { engine: engine, ready: false, lastUsed: now(), waiting: [] };
    engine.on('ready', function () {
      entry.ready = true;
      // nada baixa até o player pedir um trecho
      engine.files.forEach(function (f) {
        f.deselect();
      });
      var waiting = entry.waiting;
      entry.waiting = [];
      waiting.forEach(function (cb) {
        cb(null, entry);
      });
    });
    engine.on('error', function (err) {
      entry.error = String((err && err.message) || err);
    });
  }
  entry.lastUsed = now();
  if (entry.ready) return back(null, entry);
  var done = false;
  var timer = setTimeout(function () {
    if (done) return;
    done = true;
    back(new Error('metadata-timeout'));
  }, METADATA_TIMEOUT_MS);
  entry.waiting.push(function (err, e) {
    if (done) return;
    done = true;
    clearTimeout(timer);
    back(err, e);
  });
}

/** Arquivo de vídeo a tocar: o pedido; num episódio, o SxxEyy; senão o maior vídeo. */
function pickFile(files, fileIdx, season, episode) {
  if (fileIdx != null && files[fileIdx]) return fileIdx;
  var videos = [];
  files.forEach(function (f, i) {
    if (VIDEO.test(f.name) && !/sample/i.test(f.name)) videos.push(i);
  });
  if (!videos.length) return -1;
  if (season != null && episode != null) {
    var pad = function (n) {
      return n < 10 ? '0' + n : String(n);
    };
    var patterns = [
      new RegExp('s0*' + season + '[ ._-]?e0*' + episode + '(?!\\d)', 'i'),
      new RegExp('\\b' + season + 'x' + pad(episode) + '\\b', 'i'),
    ];
    for (var p = 0; p < patterns.length; p++) {
      for (var v = 0; v < videos.length; v++) {
        if (patterns[p].test(files[videos[v]].name)) return videos[v];
      }
    }
  }
  return videos.sort(function (a, b) {
    return files[b].length - files[a].length;
  })[0];
}

function fileList(engine) {
  return engine.files.map(function (f, i) {
    return { idx: i, name: f.name, path: f.path, length: f.length };
  });
}

function stats(entry, idx) {
  var engine = entry.engine;
  var swarm = engine.swarm;
  var file = engine.files[idx];
  return {
    name: engine.torrent ? engine.torrent.name : null,
    file: file ? file.name : null,
    length: file ? file.length : 0,
    peers: swarm ? swarm.wires.length : 0,
    queued: swarm ? swarm.queued : 0,
    downloaded: swarm ? swarm.downloaded : 0,
    uploaded: swarm ? swarm.uploaded : 0,
    downloadSpeed: swarm ? swarm.downloadSpeed() : 0,
    uploadSpeed: swarm ? swarm.uploadSpeed() : 0,
    error: entry.error || null,
  };
}

/** O arquivo, com Range: o player pede trechos, e cada trecho baixa com prioridade. */
function serveFile(req, res, entry, idx) {
  var file = entry.engine.files[idx];
  if (!file) return send(res, 404, { error: 'file-not-found' });
  var ext = (file.name.split('.').pop() || '').toLowerCase();
  var type = MIME[ext] || 'application/octet-stream';
  var total = file.length;
  var range = req.headers.range;
  var start = 0;
  var end = total - 1;
  var status = 200;
  if (range) {
    var m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1]) start = Number(m[1]);
      if (m[2]) end = Math.min(Number(m[2]), total - 1);
      if (!m[1] && m[2]) {
        start = Math.max(0, total - Number(m[2]));
        end = total - 1;
      }
      status = 206;
    }
  }
  if (start > end || start >= total) {
    return send(res, 416, '', { 'Content-Range': 'bytes */' + total });
  }
  var headers = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
  };
  if (status === 206) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + total;
  if (req.method === 'HEAD') return send(res, status, '', headers);
  var h = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
    'Cache-Control': 'no-store',
  };
  var k;
  for (k in headers) h[k] = headers[k];
  res.writeHead(status, h);
  var stream = file.createReadStream({ start: start, end: end });
  stream.pipe(res);
  var stop = function () {
    try {
      stream.destroy();
    } catch (e) {
      /* já fechado */
    }
  };
  req.on('close', stop);
  res.on('close', stop);
  stream.on('error', function () {
    try {
      res.end();
    } catch (e) {
      /* já fechado */
    }
  });
}

/**
 * O título está em algum streaming no Brasil (assinatura ou grátis)? Aluguel e
 * compra não contam. Daqui, e não do app, porque o JustWatch só libera CORS
 * para localhost. Busca pelo nome e confere o IMDb; não achou: null.
 */
var STREAMING = ['FLATRATE', 'FLATRATE_AND_BUY', 'FREE', 'ADS'];
var STREAMING_TTL_MS = 6 * 60 * 60 * 1000;
var streamingCache = {};
var STREAMING_QUERY =
  'query S($q: String!, $types: [ObjectType!]) { popularTitles(country: BR, first: 10, filter: { searchQuery: $q, objectTypes: $types }) {' +
  ' edges { node { content(country: BR, language: "pt") { externalIds { imdbId } } offers(country: BR, platform: WEB) { monetizationType } } } } }';

function streamingInBrazil(imdb, q, type, back) {
  var cached = streamingCache[imdb];
  if (cached && now() - cached.at < STREAMING_TTL_MS) return back(cached.value);
  var body = JSON.stringify({
    query: STREAMING_QUERY,
    variables: { q: q, types: [type === 'series' ? 'SHOW' : 'MOVIE'] },
  });
  var done = false;
  var finish = function (value) {
    if (done) return;
    done = true;
    if (value !== null) streamingCache[imdb] = { at: now(), value: value };
    back(value);
  };
  var req = https.request(
    {
      host: 'apis.justwatch.com',
      path: '/graphql',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    },
    function (res) {
      var chunks = [];
      res.on('data', function (c) {
        chunks.push(c);
      });
      res.on('end', function () {
        try {
          var edges = JSON.parse(Buffer.concat(chunks).toString()).data.popularTitles.edges;
          var match = edges.filter(function (e) {
            return e.node.content && e.node.content.externalIds && e.node.content.externalIds.imdbId === imdb;
          })[0];
          if (!match) return finish(null);
          finish(
            (match.node.offers || []).some(function (o) {
              return STREAMING.indexOf(o.monetizationType) >= 0;
            }),
          );
        } catch (e) {
          finish(null);
        }
      });
    },
  );
  req.setTimeout(5000, function () {
    req.abort();
    finish(null);
  });
  req.on('error', function () {
    finish(null);
  });
  req.end(body);
}

function handle(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, '');
  var parsed = url.parse(req.url, true);
  var parts = parsed.pathname.split('/').filter(Boolean);
  var query = parsed.query;

  if (!parts.length || parts[0] === 'health' || parts[0] === 'settings') {
    return send(res, 200, { ok: true, engine: 'freeflix', engines: Object.keys(engines).length });
  }
  if (parts[0] === 'removeAll') {
    Object.keys(engines).forEach(remove);
    return send(res, 200, { ok: true });
  }

  if (parts[0] === 'streaming-br') {
    if (!/^tt\d+$/.test(String(query.imdb)) || !query.q) return send(res, 400, { error: 'imdb-e-q' });
    return streamingInBrazil(String(query.imdb), String(query.q), String(query.type || 'movie'), function (value) {
      send(res, 200, { streaming: value });
    });
  }

  var hash = String(parts[0]).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(hash)) return send(res, 400, { error: 'bad-infohash' });

  if (parts[1] === 'remove') {
    remove(hash);
    return send(res, 200, { ok: true });
  }

  if (parts[1] === 'create') {
    var season = query.s != null ? Number(query.s) : null;
    var episode = query.e != null ? Number(query.e) : null;
    var wanted = query.fileIdx != null && query.fileIdx !== '' ? Number(query.fileIdx) : null;
    return open(hash, trackersFrom(query), function (err, entry) {
      if (err) return send(res, 504, { error: String(err.message || err) });
      var files = entry.engine.files;
      var idx = pickFile(files, wanted, season, episode);
      if (idx < 0) return send(res, 404, { error: 'no-video-file', files: fileList(entry.engine) });
      send(res, 200, {
        infoHash: hash,
        name: entry.engine.torrent ? entry.engine.torrent.name : null,
        files: fileList(entry.engine),
        fileIdx: idx,
      });
    });
  }

  var idx = Number(parts[1]);
  var entry = engines[hash];
  if (!entry || !entry.ready || isNaN(idx)) return send(res, 404, { error: 'not-open' });
  entry.lastUsed = now();
  if (parts[2] === 'stats.json') return send(res, 200, stats(entry, idx));
  return serveFile(req, res, entry, idx);
}

// torrent parado há muito tempo sai (TV com pouco espaço)
setInterval(function () {
  Object.keys(engines).forEach(function (hash) {
    if (now() - engines[hash].lastUsed > IDLE_MS) remove(hash);
  });
}, 60000);

// sobras de uma execução anterior (app fechado no meio): espaço da TV
rimraf(STORE, function () {});

var server = http.createServer(function (req, res) {
  try {
    handle(req, res);
  } catch (err) {
    send(res, 500, { error: String((err && err.message) || err) });
  }
});
server.listen(PORT, HOST, function () {
  console.log('[torrent] ouvindo em http://' + HOST + ':' + PORT + ' (dados em ' + STORE + ')');
});

module.exports = {
  close: function () {
    Object.keys(engines).forEach(remove);
    server.close();
  },
};
