// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
'use strict';

const assert = require('assert');
const { MAX_FILE_BYTES, metadata, Receiver, safeName } = require('../classroom-file-transfer.js');

assert.strictEqual(safeName('../lesson.pdf'), '.._lesson.pdf');
assert.strictEqual(metadata({ id: '1', name: 'lesson.pdf', size: MAX_FILE_BYTES, mimeType: 'application/pdf' }).size, MAX_FILE_BYTES);
assert.strictEqual(metadata({ id: '1', name: 'oversized', size: MAX_FILE_BYTES + 1, mimeType: '' }), null);

const receiver = new Receiver();
assert.strictEqual(receiver.start({ id: 'a', name: 'lesson.pdf', size: 3, mimeType: 'application/pdf' }), true);
assert.strictEqual(receiver.start({ id: 'b', name: 'other.pdf', size: 0, mimeType: '' }), false);
assert.strictEqual(receiver.append(Uint8Array.from([1, 2, 3]).buffer), true);
assert.strictEqual(receiver.append(Uint8Array.from([4]).buffer), false);
assert.strictEqual(receiver.finish('wrong-id'), null);
assert.strictEqual(receiver.finish('a').received, 3);
assert.strictEqual(receiver.finish('a'), null);

assert.strictEqual(receiver.start({ id: 'b', name: 'empty.txt', size: 0, mimeType: 'text/plain' }), true);
assert.strictEqual(receiver.finish('b').received, 0);

console.log('classroom-file-transfer: passed');
