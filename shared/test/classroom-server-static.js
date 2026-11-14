// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
'use strict';

const assert = require('assert');
const { ClassroomServer } = require('../classroom-server.js');

function get(server, url) {
  const response = { status: 0, headers: {}, body: '' };
  server._http({ method: 'GET', url }, {
    writeHead(status, headers = {}) {
      response.status = status;
      response.headers = headers;
    },
    end(body = '') {
      response.body = String(body);
    },
  });
  return response;
}

const server = new ClassroomServer({ WebSocketServer: function WebSocketServer() {} });
const page = get(server, '/');
assert.strictEqual(page.status, 200);
assert.match(page.body, /classroom-file-transfer\.js/);
const helper = get(server, '/classroom-file-transfer.js');
assert.strictEqual(helper.status, 200);
assert.match(helper.headers['Content-Type'], /javascript/);
assert.match(helper.body, /class Receiver/);

console.log('classroom-server-static: passed');
