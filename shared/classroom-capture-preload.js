// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('classroomCapture', {
  onCommand: (fn) => ipcRenderer.on('classroom-capture-command', (_event, message) => fn(message)),
  ready: () => ipcRenderer.send('classroom-capture-ready'),
  event: (message) => ipcRenderer.send('classroom-capture-event', message),
});
