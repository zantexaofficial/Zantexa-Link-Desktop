'use strict';

(function expose(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClassroomFileTransfer = api;
})(globalThis, () => {
  const MAX_FILE_BYTES = 100 * 1024 * 1024;
  const CHUNK_BYTES = 32 * 1024;

  function safeName(name) {
    const clean = name.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 255);
    return clean && clean !== '.' && clean !== '..' ? clean : 'classroom-file';
  }

  function metadata(file) {
    if (!file || typeof file.id !== 'string' || !file.id || file.id.length > 64
      || typeof file.name !== 'string' || !file.name || file.name.length > 255
      || !Number.isInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES
      || typeof file.mimeType !== 'string' || file.mimeType.length > 128) return null;
    const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType) ? file.mimeType : 'application/octet-stream';
    return { id: file.id, name: safeName(file.name), size: file.size, mimeType };
  }

  class Receiver {
    constructor() {
      this.file = null;
    }

    start(file) {
      const clean = metadata(file);
      if (!clean || this.file) return false;
      this.file = { ...clean, chunks: [], received: 0 };
      return true;
    }

    append(data) {
      if (!this.file || !(data instanceof ArrayBuffer) || data.byteLength < 1
        || this.file.received + data.byteLength > this.file.size) return false;
      this.file.chunks.push(data);
      this.file.received += data.byteLength;
      return true;
    }

    finish(id) {
      if (!this.file || this.file.id !== id || this.file.received !== this.file.size) return null;
      const file = this.file;
      this.file = null;
      return file;
    }

    abort(id) {
      if (!this.file || this.file.id !== id) return false;
      this.file = null;
      return true;
    }

    clear() {
      this.file = null;
    }
  }

  return { MAX_FILE_BYTES, CHUNK_BYTES, metadata, safeName, Receiver };
});
