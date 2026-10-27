/* Entrada do motor como serviço do app na TV (<tizen:service> do config.xml).
 * O app sobe o serviço ao abrir (src/platform/tizen.ts); o motor ouve em
 * 127.0.0.1:2710 enquanto o serviço estiver no ar.
 */
'use strict';

var engine = null;

module.exports.onStart = function () {
  if (!engine) engine = require('./server.js');
};

module.exports.onRequest = module.exports.onStart;

module.exports.onExit = function () {
  if (engine) engine.close();
  engine = null;
};

module.exports.onStop = module.exports.onExit;
