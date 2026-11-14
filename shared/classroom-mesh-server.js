// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { ClassroomRoom, MAX_STUDENTS } = require('./classroom-room.js');
const P = require('./protocol.js');

const PREFIX = 'classroom.';
const ROOM_TTL_MS = 20_000;
const ROOM_REFRESH_MS = 5_000;
const MAX_MESH_STUDENTS = Math.min(MAX_STUDENTS, P.MAX_DEVICES - 1);
const validId = (id) => typeof id === 'string' && id.length > 0 && id.length <= 64;
function validSignal(signal, allowed) {
  if (!signal || typeof signal !== 'object' || Array.isArray(signal) || !allowed.includes(signal.type)) return false;
  if (signal.type === 'offer' || signal.type === 'answer') {
    return typeof signal.sdp === 'string' && signal.sdp.length > 0 && signal.sdp.length <= 1_000_000;
  }
  return signal.type === 'ice' && signal.candidate && typeof signal.candidate === 'object'
    && typeof signal.candidate.candidate === 'string' && signal.candidate.candidate.length <= 8192;
}

class ClassroomMeshServer extends EventEmitter {
  constructor({ hub, selfId, selfName, maxStudents = MAX_MESH_STUDENTS } = {}) {
    super();
    if (!hub || !hub.bus || typeof hub.bus.send !== 'function') throw new TypeError('Mesh hub is required');
    if (!validId(selfId)) throw new TypeError('Local device ID is required');
    if (!Number.isInteger(maxStudents) || maxStudents < 1 || maxStudents > MAX_MESH_STUDENTS) {
      throw new RangeError(`Classroom capacity must be between 1 and ${MAX_MESH_STUDENTS}`);
    }
    this.hub = hub;
    this.selfId = selfId;
    this.selfName = String(selfName || 'Teacher').slice(0, 64);
    this.maxStudents = maxStudents;
    this.room = null;
    this.roomId = '';
    this.rooms = new Map();
    this.joined = null;
    this.sharing = false;
    this._message = (msg, fromId) => this._onMessage(msg, fromId);
    this._peerAdded = (id) => this._sendRoom(id);
    this._peerRemoved = (id) => this._peerLeft(id);
    this.messageTypes = [
      'classroom.room', 'classroom.join', 'classroom.pending', 'classroom.decision', 'classroom.signal',
      'classroom.end', 'classroom.left', 'classroom.denied',
    ];
    for (const type of this.messageTypes) hub.bus.on(type, this._message);
    hub.on('peerAdded', this._peerAdded);
    hub.on('peerRemoved', this._peerRemoved);
    this.sweep = setInterval(() => this._expireRooms(), ROOM_REFRESH_MS);
    if (this.sweep.unref) this.sweep.unref();
  }

  async start() {
    if (this.joined) throw new Error('Leave the student class before starting a teacher room');
    if (!this.room) {
      this.room = new ClassroomRoom({ maxStudents: this.maxStudents });
      this.roomId = crypto.randomUUID();
      this.sharing = false;
      this._broadcastRoom();
      this._changed();
    }
    return this.view();
  }

  async stop() {
    if (this.room) {
      this._broadcast({ t: 'classroom.end', roomId: this.roomId });
      this.room = null;
      this.roomId = '';
      this.sharing = false;
      this._changed();
    }
    if (this.joined) {
      this.hub.bus.send(this.joined.peerId, { t: 'classroom.left', roomId: this.joined.roomId });
      this.joined = null;
      this.emit('viewer-ended');
      this._changed();
    }
  }

  async close() {
    clearInterval(this.sweep);
    await this.stop();
    for (const type of this.messageTypes) {
      this.hub.bus.off(type, this._message);
    }
    this.hub.off('peerAdded', this._peerAdded);
    this.hub.off('peerRemoved', this._peerRemoved);
  }

  requestJoin(peerId, roomId, code, name) {
    const room = this.rooms.get(peerId);
    if (this.room || !room || room.roomId !== roomId || typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
    if (!validId(peerId) || this.joined) return false;
    const cleanName = String(name || '').trim().slice(0, 48) || 'Student';
    const sent = this.hub.bus.send(peerId, {
      t: 'classroom.join', roomId, code, name: cleanName,
    });
    if (!sent) return false;
    this.joined = { peerId, roomId, name: room.name, state: 'pending' };
    this._changed();
    return true;
  }

  leave() {
    if (!this.joined) return false;
    this.hub.bus.send(this.joined.peerId, { t: 'classroom.left', roomId: this.joined.roomId });
    this.joined = null;
    this.emit('viewer-ended');
    this._changed();
    return true;
  }

  decide(id, accept) {
    if (!this.room || !validId(id)) return false;
    if (accept !== true && this.room.students.has(id)) {
      this.room.remove(id);
      this.hub.bus.send(id, { t: 'classroom.decision', roomId: this.roomId, accepted: false });
      this.emit('left', id);
      this._changed();
      return true;
    }
    const student = this.room.decide(id, accept === true);
    if (!student) return false;
    this.hub.bus.send(id, { t: 'classroom.decision', roomId: this.roomId, accepted: student.state === 'accepted' });
    if (student.state === 'accepted') this.emit('accepted', { id, name: student.name });
    this._changed();
    return student.state === 'accepted';
  }

  sendTo(id, message) {
    if (!this.room || !this.room.students.has(id) || !message || message.type !== 'signal') return false;
    if (!validSignal(message.signal, ['offer', 'ice'])) return false;
    return this.hub.bus.send(id, { t: 'classroom.signal', roomId: this.roomId, signal: message.signal });
  }

  sendViewerSignal(signal) {
    if (!this.joined || this.joined.state !== 'accepted') return false;
    if (!validSignal(signal, ['answer', 'ice'])) return false;
    return this.hub.bus.send(this.joined.peerId, {
      t: 'classroom.signal', roomId: this.joined.roomId, signal,
    });
  }

  setSharing(sharing) {
    if (!this.room) return;
    this.sharing = sharing === true;
    this._broadcastRoom();
    this._changed();
  }

  view() {
    const room = this.room && this.room.list();
    const peers = this.hub.peers().filter((peer) => peer.connected && peer.id !== this.selfId);
    const rooms = [...this.rooms.entries()]
      .filter(([, item]) => Date.now() - item.updatedAt < ROOM_TTL_MS)
      .map(([peerId, item]) => ({
        peerId,
        roomId: item.roomId,
        name: item.name,
        codeRequired: true,
        sharing: item.sharing,
      }));
    return {
      transport: 'mesh',
      running: !!this.room,
      roomId: this.roomId,
      code: this.room ? this.room.code : '',
      port: 0,
      addresses: [],
      pending: room ? room.pending : [],
      students: room ? room.students : [],
      sharing: this.sharing,
      peers: peers.map(({ id, name, os }) => ({ id, name, os })),
      rooms,
      joined: this.joined ? { ...this.joined } : null,
    };
  }

  _onMessage(msg, fromId) {
    if (!msg || typeof msg.t !== 'string' || !msg.t.startsWith(PREFIX) || !validId(fromId) || !this._isMeshPeer(fromId)) return;
    if (msg.t === 'classroom.room') {
      if (typeof msg.roomId !== 'string' || msg.roomId.length > 64 || typeof msg.name !== 'string') return;
      this.rooms.set(fromId, {
        roomId: msg.roomId,
        name: String(msg.name || 'Teacher').slice(0, 64),
        sharing: msg.sharing === true,
        updatedAt: Date.now(),
      });
      this._changed();
    } else if (msg.t === 'classroom.end') {
      const current = this.rooms.get(fromId);
      if (current && current.roomId === msg.roomId) this.rooms.delete(fromId);
      if (this.joined && this.joined.peerId === fromId && this.joined.roomId === msg.roomId) {
        this.joined = null;
        this.emit('viewer-ended');
      }
      this._changed();
    } else if (msg.t === 'classroom.join' && this.room && msg.roomId === this.roomId) {
      const result = this.room.request(fromId, msg.name, msg.code);
      if (result.ok) {
        this.hub.bus.send(fromId, {
          t: result.state === 'accepted' ? 'classroom.decision' : 'classroom.pending',
          roomId: this.roomId,
          ...(result.state === 'accepted' ? { accepted: true } : {}),
        });
        this._changed();
      } else {
        this.hub.bus.send(fromId, { t: 'classroom.denied', roomId: this.roomId, reason: result.error });
      }
    } else if (msg.t === 'classroom.pending' && this.joined && this.joined.peerId === fromId && this.joined.roomId === msg.roomId) {
      this.joined.state = 'pending';
      this._changed();
    } else if (msg.t === 'classroom.denied' && this.joined && this.joined.peerId === fromId && this.joined.roomId === msg.roomId) {
      this.joined = null;
      this.emit('viewer-ended');
      this._changed();
      this.emit('join-error', msg.reason === 'code' ? 'The room code was incorrect.' : 'The teacher could not accept this request.');
    } else if (msg.t === 'classroom.decision' && this.joined && this.joined.peerId === fromId && this.joined.roomId === msg.roomId) {
      if (msg.accepted === true) {
        this.joined.state = 'accepted';
        this.emit('viewer-start', { teacherId: fromId, roomId: msg.roomId, name: this.joined.name });
      } else {
        this.joined = null;
        this.emit('viewer-ended');
        this.emit('join-error', 'The teacher declined your request.');
      }
      this._changed();
    } else if (msg.t === 'classroom.signal' && msg.roomId === this.roomId && this.room && this.room.students.has(fromId)
      && validSignal(msg.signal, ['answer', 'ice'])) {
      this.emit('signal', fromId, msg.signal);
    } else if (msg.t === 'classroom.signal' && this.joined && this.joined.peerId === fromId && this.joined.roomId === msg.roomId
      && this.joined.state === 'accepted' && validSignal(msg.signal, ['offer', 'ice'])) {
      this.emit('viewer-signal', fromId, msg.roomId, msg.signal);
    } else if (msg.t === 'classroom.left' && this.room && msg.roomId === this.roomId) {
      const wasStudent = this.room.students.has(fromId);
      if (this.room.remove(fromId)) {
        if (wasStudent) this.emit('left', fromId);
        this._changed();
      }
    }
  }

  _peerLeft(id) {
    this.rooms.delete(id);
    if (this.room) {
      const wasStudent = this.room.students.has(id);
      if (this.room.remove(id)) {
        if (wasStudent) this.emit('left', id);
        this._changed();
      }
    }
    if (this.joined && this.joined.peerId === id) {
      this.joined = null;
      this.emit('viewer-ended');
      this._changed();
    }
  }

  _expireRooms() {
    const now = Date.now();
    let changed = false;
    for (const [id, room] of this.rooms) {
      if (now - room.updatedAt >= ROOM_TTL_MS) {
        this.rooms.delete(id);
        changed = true;
      }
    }
    if (this.room) this._broadcastRoom();
    if (changed) this._changed();
  }

  _broadcastRoom() {
    for (const id of this._connectedMeshIds()) this._sendRoom(id);
  }

  _sendRoom(id) {
    if (!this.room || !this._isMeshPeer(id)) return;
    this.hub.bus.send(id, {
      t: 'classroom.room',
      roomId: this.roomId,
      name: this.selfName,
      sharing: this.sharing,
      maxStudents: this.maxStudents,
    });
  }

  _broadcast(message) {
    for (const id of this._connectedMeshIds()) this.hub.bus.send(id, message);
  }

  _isMeshPeer(id) {
    const peer = this.hub.mesh && this.hub.mesh.get(id);
    return !!peer && peer.mesh === true && this.hub.bus.connectedIds().includes(id);
  }

  _connectedMeshIds() {
    return this.hub.bus.connectedIds().filter((id) => this._isMeshPeer(id));
  }

  _changed() {
    this.emit('change', this.view());
  }
}

module.exports = { ClassroomMeshServer, ROOM_TTL_MS, ROOM_REFRESH_MS, MAX_MESH_STUDENTS };
