// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
// Local-only classroom admission and WebRTC signaling. Media and files go peer-to-peer on the LAN.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { ClassroomRoom } = require('./classroom-room.js');

const MAX_BAD_CODES = 5;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_ENTRIES = 512;
const MAX_OPEN_CONNECTIONS = 64;
const PAGE = path.join(__dirname, 'classroom-student.html');
const CLIENT = path.join(__dirname, 'classroom-student.js');
const FILE_TRANSFER = path.join(__dirname, 'classroom-file-transfer.js');

function localAddresses() {
  const found = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal && !item.address.startsWith('169.254.')) found.push(item.address);
    }
  }
  const unique = [...new Set(found)];
  const rank = (ip) => {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) ? 0 : 1;
  };
  return unique.sort((a, b) => rank(a) - rank(b));
}

class ClassroomServer extends EventEmitter {
  constructor({ WebSocketServer, port = 0, host = '0.0.0.0', maxStudents } = {}) {
    super();
    if (typeof WebSocketServer !== 'function') throw new TypeError('WebSocketServer is required');
    this.WebSocketServer = WebSocketServer;
    this.port = port;
    this.host = host;
    this.maxStudents = maxStudents;
    this.httpServer = null;
    this.wsServer = null;
    this.starting = null;
    this.room = null;
    this.clients = new Map();
    this.rate = new Map();
    this.addresses = [];
    this.sharing = false;
  }

  async start() {
    if (this.httpServer) return this.view();
    if (this.starting) return this.starting;
    this.starting = this._start();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async _start() {
    this.room = new ClassroomRoom({ maxStudents: this.maxStudents });
    this.rate.clear();
    const server = http.createServer((req, res) => this._http(req, res));
    const wss = new this.WebSocketServer({ noServer: true, maxPayload: 1_048_576 });
    server.on('upgrade', (req, socket, head) => {
      if (req.url !== '/classroom-signal') {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    wss.on('connection', (ws, req) => this._connect(ws, req));
    await new Promise((resolve, reject) => {
      const onError = (err) => {
        server.off('listening', onListening);
        reject(err);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.port, this.host);
    });
    this.httpServer = server;
    this.wsServer = wss;
    this.port = server.address().port;
    this.addresses = localAddresses();
    this._changed();
    return this.view();
  }

  _http(req, res) {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      return res.end();
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname === '/' || pathname === '/classroom' ? PAGE
      : pathname === '/classroom-student.js' ? CLIENT
        : pathname === '/classroom-file-transfer.js' ? FILE_TRANSFER
        : pathname === '/classroom-student.css' ? path.join(__dirname, 'classroom-student.css') : null;
    if (!file) {
      res.writeHead(404);
      return res.end('Not found');
    }
    let body;
    try {
      body = fs.readFileSync(file);
    } catch (e) {
      console.error('[classroom] could not read student page:', e.message);
      res.writeHead(500);
      return res.end('Classroom page unavailable');
    }
    const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
    res.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; media-src 'self' blob:",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(body);
  }

  _connect(ws, req) {
    if (this.clients.size >= MAX_OPEN_CONNECTIONS) {
      ws.close(1013, 'Classroom is busy');
      return;
    }
    const id = crypto.randomUUID();
    const ip = req.socket.remoteAddress || '';
    const client = { id, ip, ws, state: 'new', name: 'Student' };
    this.clients.set(id, client);
    ws.on('message', (raw) => this._message(client, raw));
    ws.on('close', () => {
      this.clients.delete(id);
      const wasStudent = this.room && this.room.students.has(id);
      if (this.room && this.room.remove(id)) {
        if (wasStudent) this.emit('left', id);
        this._changed();
      }
    });
    ws.on('error', (e) => console.warn('[classroom] student socket:', e.message));
    this._send(client, { type: 'hello' });
  }

  _message(client, raw) {
    if (!this.room) return this._send(client, { type: 'error', reason: 'room_closed' });
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return this._send(client, { type: 'error', reason: 'message' });
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    if (client.state === 'new') {
      if (msg.type !== 'join') return this._send(client, { type: 'error', reason: 'join_required' });
      if (!this._allowAttempt(client.ip)) return this._send(client, { type: 'error', reason: 'rate_limited' });
      const result = this.room.request(client.id, msg.name, msg.code);
      if (!result.ok) return this._send(client, { type: 'error', reason: result.error });
      client.state = result.state;
      client.name = result.student ? result.student.name : 'Student';
      this._send(client, { type: result.state });
      if (result.state === 'pending') this._changed();
      return;
    }
    if (client.state === 'accepted' && msg.type === 'signal' && msg.signal && typeof msg.signal === 'object') {
      const signal = msg.signal;
      if ((signal.type === 'answer' && typeof signal.sdp === 'string' && signal.sdp.length <= 1_000_000)
        || (signal.type === 'ice' && signal.candidate && typeof signal.candidate === 'object')) {
        this.emit('signal', client.id, signal);
      }
    }
  }

  _allowAttempt(ip) {
    const now = Date.now();
    const old = this.rate.get(ip);
    if (!old || now - old.start >= RATE_WINDOW_MS) {
      if (!old && this.rate.size >= MAX_RATE_ENTRIES) {
        for (const [key, entry] of this.rate) if (now - entry.start >= RATE_WINDOW_MS) this.rate.delete(key);
        if (this.rate.size >= MAX_RATE_ENTRIES) return false;
      }
      this.rate.set(ip, { start: now, count: 1 });
      return true;
    }
    old.count++;
    return old.count <= MAX_BAD_CODES;
  }

  _send(client, message) {
    if (client.ws.readyState !== 1) return false;
    client.ws.send(JSON.stringify(message));
    return true;
  }

  decide(id, accept) {
    if (accept !== true && this.room && this.room.students.has(id)) {
      const client = this.clients.get(id);
      this.room.remove(id);
      if (client) {
        this._send(client, { type: 'declined' });
        client.state = 'removed';
        client.ws.close(1000, 'Removed by teacher');
      }
      this.emit('left', id);
      this._changed();
      return true;
    }
    const student = this.room && this.room.decide(id, accept);
    if (!student) return false;
    const client = this.clients.get(id);
    if (student.state === 'accepted' && client) {
      client.state = 'accepted';
      this._send(client, { type: 'accepted' });
      this.emit('accepted', { id, name: student.name });
    } else {
      if (client) {
        this._send(client, { type: 'declined' });
        client.state = 'declined';
        client.ws.close(1000, 'Request declined by teacher');
      }
    }
    this._changed();
    return student.state === 'accepted';
  }

  sendTo(id, message) {
    const client = this.clients.get(id);
    if (!client || client.state !== 'accepted') return false;
    return this._send(client, message);
  }

  setSharing(sharing) {
    this.sharing = sharing === true;
    this._changed();
  }

  view() {
    if (!this.httpServer || !this.room) return { running: false, code: '', port: 0, addresses: [], pending: [], students: [], sharing: false };
    const { pending, students } = this.room.list();
    return { running: true, code: this.room.code, port: this.port, addresses: this.addresses.slice(), pending, students, sharing: this.sharing };
  }

  _changed() {
    this.emit('change', this.view());
  }

  async stop() {
    if (this.starting) await this.starting;
    const wss = this.wsServer;
    const server = this.httpServer;
    this.wsServer = null;
    this.httpServer = null;
    this.room = null;
    this.clients.clear();
    this.addresses = [];
    this.sharing = false;
    if (wss) {
      for (const client of wss.clients) client.close(1001, 'Class ended');
      await new Promise((resolve) => wss.close(resolve));
    }
    if (server && server.listening) await new Promise((resolve) => server.close(resolve));
    this._changed();
  }
}

module.exports = { ClassroomServer, localAddresses, MAX_BAD_CODES, RATE_WINDOW_MS, MAX_RATE_ENTRIES, MAX_OPEN_CONNECTIONS };
