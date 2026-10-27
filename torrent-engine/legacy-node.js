/* Buffer.from/alloc/allocUnsafe para o Node 4.4 da TV antiga (Tizen 5): vieram
 * no Node 4.5/5.10, e as dependências do motor usam. Entra antes de tudo no
 * pacote da TV (build.mjs).
 */
'use strict';

if (!Buffer.alloc) {
  Buffer.alloc = function (size, fill, encoding) {
    var buf = new Buffer(size);
    buf.fill(fill === undefined ? 0 : fill, encoding);
    return buf;
  };
}
if (!Buffer.allocUnsafe) {
  Buffer.allocUnsafe = function (size) {
    return new Buffer(size);
  };
}
if (!Buffer.allocUnsafeSlow) Buffer.allocUnsafeSlow = Buffer.allocUnsafe;
// No Node 4.4, Buffer.from é o Uint8Array.from herdado (só leitura): defineProperty sobrepõe
try {
  if (!Buffer.isBuffer(Buffer.from('a'))) throw new Error('Uint8Array.from');
} catch (e) {
  var NodeBuffer = Buffer;
  var from = function (value, encodingOrOffset, length) {
    if (value instanceof ArrayBuffer) {
      var view = new Uint8Array(value, encodingOrOffset || 0, length === undefined ? value.byteLength - (encodingOrOffset || 0) : length);
      return new NodeBuffer(view);
    }
    return encodingOrOffset === undefined ? new NodeBuffer(value) : new NodeBuffer(value, encodingOrOffset);
  };
  Object.defineProperty(Buffer, 'from', { value: from, writable: true, configurable: true });
}
