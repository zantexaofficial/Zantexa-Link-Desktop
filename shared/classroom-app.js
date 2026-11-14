// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
// Register the standalone classroom API once in each desktop main process.
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const { ClassroomController } = require('./classroom-controller.js');

function install({ WebSocketServer, server } = {}) {
  const classroom = new ClassroomController({
    server,
    WebSocketServer,
    onChange: () => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('classroom-state', classroom.view());
      }
    },
  });
  const handlers = {
    classroomState: () => classroom.view(),
    classroomStart: () => classroom.startRoom(),
    classroomStop: () => classroom.stopRoom(),
    classroomDisplays: () => classroom.displays(),
    classroomShare: (sourceId) => classroom.startBroadcast(sourceId),
    classroomShareFiles: () => classroom.shareFiles(),
    classroomStopShare: () => classroom.stopBroadcast(),
    classroomDecide: (id, accept) => typeof id === 'string' && classroom.decide(id, accept === true),
    classroomJoin: (address, code) => classroom.openJoinPage(address, code),
    classroomJoinPeer: (peerId, roomId, code, name) => classroom.joinPeer(peerId, roomId, code, name),
    classroomLeave: () => classroom.leaveClass(),
  };
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(name, (_event, ...args) => handler(...args));
  }
  app.once('before-quit', () => { classroom.close().catch((e) => console.error('[classroom] shutdown:', e)); });
  return classroom;
}

module.exports = { install };
