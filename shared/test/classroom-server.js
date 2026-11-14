// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
// Offline classroom admission and signaling over the local HTTP/WebSocket server.
'use strict';

const assert = require('assert');
const http = require('http');
const WebSocket = require('ws');
const { ClassroomServer } = require('../classroom-server.js');

function onceMessage(ws, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for a classroom message')), 3000);
    const onMessage = (raw) => {
      let msg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!predicate(msg)) return;
      clearTimeout(timer);
      ws.off('message', onMessage);
      resolve(msg);
    };
    ws.on('message', onMessage);
  });
}

async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/classroom-signal`);
  const hello = onceMessage(ws, (m) => m.type === 'hello');
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await hello;
  return ws;
}

async function join(ws, code, name) {
  const response = onceMessage(ws, (m) => ['pending', 'error'].includes(m.type));
  ws.send(JSON.stringify({ type: 'join', code, name }));
  return response;
}

async function run() {
  const server = new ClassroomServer({ WebSocketServer: WebSocket.Server, host: '127.0.0.1', port: 0, maxStudents: 2 });
  const clients = [];
  try {
    const [started, startedAgain] = await Promise.all([server.start(), server.start()]);
    assert.strictEqual(started.running, true);
    assert.strictEqual(startedAgain.port, started.port);
    assert.strictEqual(startedAgain.code, started.code);
    assert.strictEqual(started.code.length, 6);
    assert.ok(started.port > 0);

    const page = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${started.port}/`, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });
    assert.strictEqual(page.status, 200);
    assert.match(page.body, /Request to join/);

    const stylesheet = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${started.port}/classroom-student.css`, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
      }).on('error', reject);
    });
    assert.strictEqual(stylesheet.status, 200);
    assert.match(stylesheet.type, /text\/css/);
    assert.match(stylesheet.body, /color-scheme/);

    const fileTransfer = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${started.port}/classroom-file-transfer.js`, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body }));
      }).on('error', reject);
    });
    assert.strictEqual(fileTransfer.status, 200);
    assert.match(fileTransfer.type, /javascript/);
    assert.match(fileTransfer.body, /class Receiver/);

    const one = await connect(started.port);
    clients.push(one);
    const firstPending = await join(one, started.code, 'Aisha');
    assert.strictEqual(firstPending.type, 'pending');
    const firstId = server.view().pending[0].id;
    const accepted = onceMessage(one, (m) => m.type === 'accepted');
    assert.strictEqual(server.decide(firstId, true), true);
    await accepted;
    assert.strictEqual(server.view().students[0].name, 'Aisha');

    let receivedSignal;
    const gotSignal = new Promise((resolve) => { receivedSignal = resolve; });
    server.once('signal', (id, signal) => receivedSignal({ id, signal }));
    one.send(JSON.stringify({ type: 'signal', signal: { type: 'answer', sdp: 'v=0' } }));
    assert.deepStrictEqual(await gotSignal, { id: firstId, signal: { type: 'answer', sdp: 'v=0' } });

    const two = await connect(started.port);
    clients.push(two);
    assert.strictEqual((await join(two, started.code, 'Bilal')).type, 'pending');
    const secondId = server.view().pending[0].id;
    const declined = onceMessage(two, (m) => m.type === 'declined');
    assert.strictEqual(server.decide(secondId, false), false);
    await declined;

    const three = await connect(started.port);
    clients.push(three);
    assert.strictEqual((await join(three, started.code, 'Sara')).type, 'pending');
    const thirdId = server.view().pending[0].id;
    const thirdAccepted = onceMessage(three, (m) => m.type === 'accepted');
    assert.strictEqual(server.decide(thirdId, true), true);
    await thirdAccepted;

    const full = await connect(started.port);
    clients.push(full);
    assert.strictEqual((await join(full, started.code, 'Noor')).reason, 'full');
    assert.strictEqual(server.view().students.length, 2);
    assert.strictEqual(server.view().pending.length, 0);
    console.log('classroom-server: passed');
  } finally {
    await server.stop();
    for (const ws of clients) ws.terminate();
  }
}

run().catch((e) => {
  console.error(e.stack || e);
  process.exitCode = 1;
});
