// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('classroomView', {
  onMessage: (fn) => ipcRenderer.on('classroom-view-message', (_event, message) => fn(message)),
  signal: (signal) => ipcRenderer.send('classroom-view-signal', { type: 'signal', signal }),
  leave: () => ipcRenderer.send('classroom-view-leave'),
});
