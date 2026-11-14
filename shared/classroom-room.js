// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
// In-memory admission state for a teacher-hosted classroom (independent of mesh pairing).
'use strict';

const crypto = require('crypto');

const MAX_STUDENTS = 30;
const MAX_NAME_LENGTH = 48;
const CODE_LENGTH = 6;

function newCode(randomInt = crypto.randomInt) {
  return String(randomInt(100000, 1000000));
}

class ClassroomRoom {
  constructor({ code = newCode(), maxStudents = MAX_STUDENTS } = {}) {
    if (!/^\d{6}$/.test(code)) throw new TypeError('Classroom code must be six digits');
    if (!Number.isInteger(maxStudents) || maxStudents < 1 || maxStudents > MAX_STUDENTS) {
      throw new RangeError(`Classroom capacity must be between 1 and ${MAX_STUDENTS}`);
    }
    this.code = code;
    this.maxStudents = maxStudents;
    this.pending = new Map();
    this.students = new Map();
  }

  request(id, name, code) {
    if (typeof id !== 'string' || !id || id.length > 64) return { ok: false, error: 'invalid' };
    if (code !== this.code) return { ok: false, error: 'code' };
    if (this.students.has(id)) return { ok: true, state: 'accepted' };
    if (this.pending.has(id)) return { ok: true, state: 'pending' };
    if (this.students.size >= this.maxStudents) return { ok: false, error: 'full' };
    if (this.pending.size + this.students.size >= this.maxStudents) return { ok: false, error: 'full' };
    const cleanName = typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : '';
    const student = { id, name: cleanName || 'Student', requestedAt: Date.now() };
    this.pending.set(id, student);
    return { ok: true, state: 'pending', student: { ...student } };
  }

  decide(id, accept) {
    const student = this.pending.get(id);
    if (!student) return null;
    this.pending.delete(id);
    if (accept !== true) return { ...student, state: 'declined' };
    if (this.students.size >= this.maxStudents) return { ...student, state: 'full' };
    const accepted = { id: student.id, name: student.name, joinedAt: Date.now() };
    this.students.set(id, accepted);
    return { ...accepted, state: 'accepted' };
  }

  remove(id) {
    return this.pending.delete(id) || this.students.delete(id);
  }

  list() {
    return {
      pending: [...this.pending.values()].map(({ id, name, requestedAt }) => ({ id, name, requestedAt })),
      students: [...this.students.values()].map(({ id, name, joinedAt }) => ({ id, name, joinedAt })),
    };
  }
}

module.exports = { ClassroomRoom, MAX_STUDENTS, MAX_NAME_LENGTH, CODE_LENGTH, newCode };
