// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
'use strict';

const assert = require('assert');
const http = require('http');
const { EventEmitter } = require('events');
const { ClassroomServer } = require('../classroom-server.js');

class FakeWebSocketServer extends EventEmitter {
  constructor() {
    super();
    this.clients = new Set();
  }

  close(callback) {
    if (callback) callback();
  }
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

async function run() {
  const occupied = http.createServer();
  const occupiedPort = await listen(occupied);
  const classroom = new ClassroomServer({ WebSocketServer: FakeWebSocketServer, host: '127.0.0.1', port: occupiedPort });
  try {
    const state = await classroom.start();
    assert.strictEqual(state.running, true);
    assert.notStrictEqual(state.port, occupiedPort);
    console.log('classroom-server-start: passed');
  } finally {
    await classroom.stop();
    await new Promise((resolve) => occupied.close(resolve));
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
