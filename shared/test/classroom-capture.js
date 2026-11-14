// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ClassroomFileTransfer = require('../classroom-file-transfer.js');

const events = [];
const channels = new Map();
let command;

class FakeDataChannel {
  constructor(label) {
    this.label = label;
    this.readyState = 'open';
    this.bufferedAmount = 0;
    this.messages = [];
  }

  send(message) {
    this.messages.push(message);
  }
}

class FakePeerConnection {
  constructor() {
    this.connectionState = 'new';
    this.fileChannel = null;
  }

  createDataChannel(label) {
    this.fileChannel = new FakeDataChannel(label);
    channels.set(this, this.fileChannel);
    return this.fileChannel;
  }

  addTrack() {
    return { getParameters: () => ({ encodings: [{}] }), setParameters: async () => {} };
  }

  async createOffer() { return { type: 'offer', sdp: 'v=0' }; }
  async setLocalDescription(description) { this.localDescription = description; }
  close() { this.connectionState = 'closed'; }
}

const track = () => ({ stop() {}, clone: track });
const window = {
  ClassroomFileTransfer,
  classroomCapture: {
    onCommand: (handler) => { command = handler; },
    ready: () => {},
    event: (event) => events.push(event),
  },
};

vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'classroom-capture.js'), 'utf8'), {
  window,
  navigator: { mediaDevices: { getUserMedia: async () => ({ getVideoTracks: () => [track()], getTracks: () => [track()] }) } },
  RTCPeerConnection: FakePeerConnection,
  MediaStream: class MediaStream {},
  setTimeout,
  Date,
});

async function run() {
  await command({ type: 'capture', sourceId: 'screen', runId: 1 });
  await command({ type: 'add', id: 'student-1' });
  await command({ type: 'add', id: 'student-2' });
  assert.ok(events.some((event) => event.type === 'captured'));

  const file = { id: 'file-1', name: 'lesson.txt', size: 3, mimeType: 'text/plain' };
  await command({ type: 'file-start', file, recipients: ['student-1', 'student-2'] });
  await command({ type: 'file-chunk', fileId: file.id, sequence: 0, data: Uint8Array.from([1, 2, 3]) });
  await command({ type: 'file-end', fileId: file.id });

  for (const channel of channels.values()) {
    assert.strictEqual(JSON.parse(channel.messages[0]).type, 'file-start');
    assert.deepStrictEqual(Array.from(channel.messages[1]), [1, 2, 3]);
    assert.deepStrictEqual(JSON.parse(channel.messages[2]), { type: 'file-end', fileId: file.id });
  }
  assert.ok(events.some((event) => event.type === 'file-finished'));

  await command({ type: 'file-start', file: { ...file, id: 'file-2' }, recipients: ['not-approved'] });
  assert.ok(events.some((event) => event.type === 'file-error' && event.fileId === 'file-2'));
  console.log('classroom-capture: passed');
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
