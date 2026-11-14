// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
// Teacher approval is explicit; a room is not a mesh pairing.
'use strict';

const assert = require('assert');
const { ClassroomRoom, MAX_STUDENTS, newCode } = require('../classroom-room.js');

assert.strictEqual(newCode(() => 100000), '100000');
assert.strictEqual(newCode(() => 999999), '999999');
assert.throws(() => new ClassroomRoom({ code: '12345' }), /six digits/);
assert.throws(() => new ClassroomRoom({ code: 'abcdef' }), /six digits/);
assert.throws(() => new ClassroomRoom({ code: '123456', maxStudents: MAX_STUDENTS + 1 }), /capacity/);

const room = new ClassroomRoom({ code: '481205', maxStudents: 2 });
assert.deepStrictEqual(room.request('s1', '  Aisha  ', '000000'), { ok: false, error: 'code' });
const first = room.request('s1', '  Aisha  ', '481205');
assert.strictEqual(first.ok, true);
assert.strictEqual(first.state, 'pending');
assert.strictEqual(first.student.name, 'Aisha');
assert.deepStrictEqual(room.request('s1', 'Aisha', '481205'), { ok: true, state: 'pending' });
assert.strictEqual(room.list().pending.length, 1);
assert.strictEqual(room.decide('missing', true), null);
assert.strictEqual(room.decide('s1', false).state, 'declined');
assert.deepStrictEqual(room.list(), { pending: [], students: [] });

room.request('s1', 'Aisha', '481205');
assert.strictEqual(room.decide('s1', true).state, 'accepted');
assert.deepStrictEqual(room.request('s1', 'Aisha', '481205'), { ok: true, state: 'accepted' });
room.request('s2', 'Bilal', '481205');
assert.strictEqual(room.request('s3', 'Sara', '481205').error, 'full');
assert.strictEqual(room.decide('s2', true).state, 'accepted');
assert.strictEqual(room.request('s3', 'Sara', '481205').error, 'full');
assert.strictEqual(room.remove('s1'), true);
assert.strictEqual(room.request('s3', 'Sara', '481205').state, 'pending');
assert.strictEqual(room.remove('s3'), true);
assert.deepStrictEqual(room.list().pending, []);

console.log('classroom-room: passed');
