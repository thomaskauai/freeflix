// torrent-stream pede só 5 blocos de 16 KB por vez a cada par, o que limita
// cada par a ~330 KB/s. Com 32 a primeira carga caiu de ~34 s para ~15 s.
var fs = require('fs');
var path = require('path');

var file = path.join(__dirname, 'node_modules/torrent-stream/index.js');
var src = fs.readFileSync(file, 'utf8');
var out = src.replace(/var MAX_REQUESTS = \d+/, 'var MAX_REQUESTS = 32');
if (out.indexOf('var MAX_REQUESTS = 32') < 0) throw new Error('MAX_REQUESTS não encontrado em ' + file);
if (out !== src) fs.writeFileSync(file, out);
