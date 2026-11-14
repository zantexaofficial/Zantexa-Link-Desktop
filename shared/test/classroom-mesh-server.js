// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const { ClassroomMeshServer, MAX_MESH_STUDENTS } = require('../classroom-mesh-server.js');

class FakeHub extends EventEmitter {
  constructor(id, name) {
    super();
    this.id = id;
    this.name = name;
    this.handlers = new Map();
    this.links = new Map();
    this.messages = [];
    this.mesh = {
      get: (peerId) => this.links.get(peerId) || null,
    };
    this.bus = {
      on: (type, fn) => {
        if (!this.handlers.has(type)) this.handlers.set(type, []);
        this.handlers.get(type).push(fn);
      },
      off: (type, fn) => {
        const handlers = this.handlers.get(type) || [];
        const index = handlers.indexOf(fn);
        if (index >= 0) handlers.splice(index, 1);
      },
      connectedIds: () => [...this.links.keys()],
      send: (to, msg) => {
        const target = this.links.get(to);
        if (!target) return false;
        this.messages.push({ to, msg });
        queueMicrotask(() => {
          for (const fn of target.hub.handlers.get(msg.t) || []) fn(msg, this.id);
        });
        return true;
      },
    };
  }

  peers() {
    return [...this.links].map(([id, peer]) => ({ id, name: peer.name, connected: true, os: 'win' }));
  }

  connect(other, mesh = true) {
    this.links.set(other.id, { id: other.id, name: other.name, mesh, hub: other });
    other.links.set(this.id, { id: this.id, name: this.name, mesh, hub: this });
    this.emit('peerAdded', other.id);
    other.emit('peerAdded', this.id);
  }
}

const wait = () => new Promise((resolve) => setImmediate(resolve));

async function run() {
  const teacherHub = new FakeHub('teacher', 'Teacher laptop');
  const studentHub = new FakeHub('student', 'Student laptop');
  const legacyHub = new FakeHub('legacy', 'Older app');
  teacherHub.connect(studentHub);
  teacherHub.connect(legacyHub, false);
  assert.strictEqual(MAX_MESH_STUDENTS, 9);
  assert.throws(() => new ClassroomMeshServer({ hub: teacherHub, selfId: 'teacher', maxStudents: 10 }), /capacity/);
  const teacher = new ClassroomMeshServer({ hub: teacherHub, selfId: 'teacher', selfName: 'Teacher laptop' });
  const student = new ClassroomMeshServer({ hub: studentHub, selfId: 'student', selfName: 'Student laptop' });
  try {
    const room = await teacher.start();
    await wait();
    assert.strictEqual(room.transport, 'mesh');
    assert.strictEqual(room.running, true);
    assert.strictEqual(student.view().rooms.length, 1);
    assert.strictEqual(teacherHub.messages.some((item) => item.to === 'legacy'), false);
    assert.strictEqual(teacherHub.messages[0].msg.code, undefined);

    const offer = { type: 'offer', sdp: 'v=0' };
    let receivedOffer;
    student.once('viewer-signal', (_peer, _room, signal) => { receivedOffer = signal; });
    const remoteRoom = student.view().rooms[0];
    assert.strictEqual(student.requestJoin('teacher', remoteRoom.roomId, '000000', 'Aisha'), true);
    await wait();
    assert.strictEqual(student.view().joined, null);

    assert.strictEqual(student.requestJoin('teacher', remoteRoom.roomId, room.code, 'Aisha'), true);
    await wait();
    assert.strictEqual(teacher.view().pending.length, 1);
    const studentStarted = new Promise((resolve) => student.once('viewer-start', resolve));
    const studentId = teacher.view().pending[0].id;
    assert.strictEqual(teacher.decide(studentId, true), true);
    assert.strictEqual((await studentStarted).name, 'Teacher laptop');

    teacher.setSharing(true);
    await wait();
    assert.strictEqual(student.view().rooms[0].sharing, true);
    assert.strictEqual(teacher.sendTo(studentId, { type: 'signal', signal: offer }), true);
    await wait();
    assert.deepStrictEqual(receivedOffer, offer);

    let receivedAnswer;
    teacher.once('signal', (_id, signal) => { receivedAnswer = signal; });
    assert.strictEqual(student.sendViewerSignal({ type: 'answer', sdp: 'v=0' }), true);
    await wait();
    assert.deepStrictEqual(receivedAnswer, { type: 'answer', sdp: 'v=0' });

    student.leave();
    await wait();
    assert.strictEqual(teacher.view().students.length, 0);
    await teacher.stop();
    await wait();
    assert.strictEqual(student.view().rooms.length, 0);
    console.log('classroom-mesh-server: passed');
  } finally {
    await teacher.close();
    await student.close();
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
