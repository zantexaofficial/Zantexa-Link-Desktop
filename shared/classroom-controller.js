// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
// Electron host: local room, teacher approval, screen broadcast, and teacher-selected class files.
'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { BrowserWindow, desktopCapturer, dialog, ipcMain } = require('electron');
const { ClassroomServer } = require('./classroom-server.js');
const { MAX_FILE_BYTES, CHUNK_BYTES } = require('./classroom-file-transfer.js');

const FILE_COMMAND_TIMEOUT_MS = 30_000;

const CHANNELS = {
  ready: 'classroom-capture-ready',
  command: 'classroom-capture-command',
  event: 'classroom-capture-event',
  viewerSignal: 'classroom-view-signal',
  viewerLeave: 'classroom-view-leave',
};

class ClassroomController {
  constructor({ WebSocketServer, server = null, onChange = () => {}, port = 43157 } = {}) {
    this.onChange = onChange;
    this.server = server || new ClassroomServer({ WebSocketServer, port });
    this.worker = null;
    this.workerReady = false;
    this.workerStartupError = null;
    this.sourceId = '';
    this.broadcastRun = 0;
    this.displayList = [];
    this.captureReady = false;
    this.broadcastStarting = false;
    this.shareError = '';
    this.closed = false;
    this.joinWindows = new Set();
    this.viewerWindow = null;
    this.viewerReady = false;
    this.viewerQueue = [];
    this.fileWaiters = new Map();
    this.fileSending = false;
    this._readyListener = (event) => {
      if (!this._fromWorker(event)) return;
      this.workerReady = true;
      for (const command of this.queue.splice(0)) this._sendWorker(command);
    };
    this._eventListener = (event, message) => {
      if (!this._fromWorker(event) || !message || typeof message !== 'object') return;
      this._workerEvent(message);
    };
    this._viewerSignalListener = (event, message) => {
      if (!this.viewerWindow || this.viewerWindow.isDestroyed() || event.sender !== this.viewerWindow.webContents) return;
      if (!message || typeof message !== 'object' || message.type !== 'signal') return;
      this.server.sendViewerSignal(message.signal);
    };
    this._viewerLeaveListener = (event) => {
      if (this.viewerWindow && !this.viewerWindow.isDestroyed() && event.sender === this.viewerWindow.webContents) this.server.leave();
    };
    this.queue = [];
    ipcMain.on(CHANNELS.ready, this._readyListener);
    ipcMain.on(CHANNELS.event, this._eventListener);
    ipcMain.on(CHANNELS.viewerSignal, this._viewerSignalListener);
    ipcMain.on(CHANNELS.viewerLeave, this._viewerLeaveListener);
    this.server.on('change', () => this.onChange());
    this.server.on('accepted', (student) => {
      if (this.captureReady) this._sendWorker({ type: 'add', id: student.id });
    });
    this.server.on('left', (id) => this._sendWorker({ type: 'remove', id }));
    this.server.on('signal', (id, signal) => this._sendWorker({ type: 'signal', id, signal }));
    this.server.on('viewer-start', (state) => this._openViewer(state));
    this.server.on('viewer-signal', (peerId, roomId, signal) => this._sendViewer({ type: 'signal', peerId, roomId, signal }));
    this.server.on('viewer-ended', () => {
      this._sendViewer({ type: 'ended' });
      if (this.viewerWindow && !this.viewerWindow.isDestroyed()) this.viewerWindow.close();
    });
    this.server.on('join-error', (message) => {
      this.shareError = message;
      this.onChange();
    });
  }

  async startRoom() {
    if (this.closed) throw new Error('Classroom is shutting down');
    return this.server.start();
  }

  async stopRoom() {
    await this.stopBroadcast();
    await this.server.stop();
  }

  async displays() {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    this.displayList = sources.map((source) => ({ id: source.id, name: source.name }));
    return this.displayList.slice();
  }

  async startBroadcast(sourceId) {
    if (!this.server.view().running) throw new Error('Start a classroom before sharing your screen');
    const sources = await this.displays();
    if (typeof sourceId !== 'string' || !sources.some((source) => source.id === sourceId)) throw new Error('Choose an available display');
    const runId = ++this.broadcastRun;
    this.sourceId = sourceId;
    this.broadcastStarting = true;
    this.shareError = '';
    this.captureReady = false;
    this.onChange();
    this._ensureWorker();
    try {
      await this._waitForWorker();
      if (runId !== this.broadcastRun || !this.server.view().running) return false;
      this._sendWorker({ type: 'capture', sourceId, runId });
    } catch (e) {
      if (runId !== this.broadcastRun) return false;
      this.broadcastStarting = false;
      this.shareError = e.message;
      this.onChange();
      throw e;
    }
    return true;
  }

  async stopBroadcast() {
    const runId = ++this.broadcastRun;
    this.broadcastStarting = false;
    this.captureReady = false;
    this.sourceId = '';
    this.shareError = '';
    this._rejectFileWaiters(new Error('Screen sharing stopped'));
    this._sendWorker({ type: 'stop', runId });
    this.server.setSharing(false);
  }

  async shareFiles() {
    if (this.fileSending) throw new Error('A classroom file transfer is already in progress');
    this.fileSending = true;
    try {
      return await this._shareFiles();
    } finally {
      this.fileSending = false;
    }
  }

  async _shareFiles() {
    if (!this.server.view().running || !this.server.view().sharing || !this.captureReady) {
      throw new Error('Start screen sharing before sending files');
    }
    const currentStudents = this.server.view().students;
    if (!currentStudents.length) throw new Error('No approved students are in the class');
    const result = await dialog.showOpenDialog({
      title: 'Share files with the class',
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return { canceled: true, files: [] };
    if (!result.filePaths.length) return { canceled: true, files: [] };

    const active = this.server.view();
    if (!active.running || !active.sharing || !this.captureReady) {
      throw new Error('Screen sharing stopped before the files could be sent');
    }
    const students = active.students;
    if (!students.length) throw new Error('No approved students are in the class');

    const selected = [];
    for (const filePath of result.filePaths) {
      const stat = await fs.promises.stat(filePath);
      const name = path.basename(filePath).replace(/[\\x00-\\x1f\\x7f]/g, '_').slice(0, 255) || 'classroom-file';
      if (!stat.isFile()) throw new Error(`${name} is not a file`);
      if (stat.size > MAX_FILE_BYTES) throw new Error(`${name} is larger than the 100 MB classroom limit`);
      selected.push({ filePath, stat, name });
    }

    const sent = [];
    for (const { filePath, stat, name } of selected) {
      const fileId = crypto.randomUUID();
      const metadata = { id: fileId, name, size: stat.size, mimeType: 'application/octet-stream' };
      const recipients = students.map((student) => student.id);
      let started;
      try {
        started = await this._fileCommand(
          { type: 'file-start', file: metadata, recipients },
          'file-started',
          fileId,
        );
      } catch (error) {
        this._sendWorker({ type: 'file-abort', fileId });
        throw error;
      }
      if (started.recipients !== recipients.length) {
        this._sendWorker({ type: 'file-abort', fileId });
        throw new Error('Not every approved student is ready to receive files. Try again shortly.');
      }

      let sequence = 0;
      let bytesRead = 0;
      try {
        const stream = fs.createReadStream(filePath, { highWaterMark: CHUNK_BYTES });
        for await (const chunk of stream) {
          bytesRead += chunk.length;
          if (bytesRead > stat.size || bytesRead > MAX_FILE_BYTES) {
            throw new Error(`${name} changed while it was being shared`);
          }
          await this._fileCommand(
            { type: 'file-chunk', fileId, sequence, data: Uint8Array.from(chunk) },
            'file-chunk-sent',
            fileId,
            sequence,
          );
          sequence++;
        }
        if (bytesRead !== stat.size) throw new Error(`${name} changed while it was being shared`);
        await this._fileCommand({ type: 'file-end', fileId }, 'file-finished', fileId);
      } catch (error) {
        this._sendWorker({ type: 'file-abort', fileId });
        throw error;
      }
      sent.push({ name, recipients: recipients.length });
    }
    return { canceled: false, files: sent };
  }

  decide(id, accept) {
    return this.server.decide(id, accept === true);
  }

  joinPeer(peerId, roomId, code, name) {
    if (typeof peerId !== 'string' || typeof roomId !== 'string' || typeof code !== 'string' || typeof name !== 'string') return false;
    this.shareError = '';
    return typeof this.server.requestJoin === 'function' && this.server.requestJoin(peerId, roomId, code, name);
  }

  leaveClass() {
    return typeof this.server.leave === 'function' && this.server.leave();
  }

  openJoinPage(address, code) {
    if (typeof address !== 'string' || address.length > 128 || typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
    const m = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(address.trim());
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) return false;
    const octets = m[1].split('.').map(Number);
    if (octets.some((n) => n > 255)) return false;
    const [a, b] = octets;
    const privateAddress = a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 127 && b === 0 && octets[2] === 0 && octets[3] === 1);
    if (!privateAddress) return false;
    const win = new BrowserWindow({
      width: 960,
      height: 720,
      title: 'Join classroom',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.joinWindows.add(win);
    win.on('closed', () => this.joinWindows.delete(win));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.loadURL(`http://${address.trim()}/?code=${encodeURIComponent(code)}`);
    return true;
  }

  view() {
    return { ...this.server.view(), displays: this.displayList.slice(), starting: this.broadcastStarting, shareError: this.shareError };
  }

  _openViewer(state) {
    if (this.viewerWindow && !this.viewerWindow.isDestroyed()) this.viewerWindow.close();
    const win = new BrowserWindow({
      width: 900,
      height: 680,
      title: `Classroom — ${String(state.name || 'Teacher').slice(0, 64)}`,
      webPreferences: {
        preload: path.join(__dirname, 'classroom-view-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.viewerWindow = win;
    this.viewerReady = false;
    this.viewerQueue = [];
    win.on('closed', () => {
      if (this.viewerWindow !== win) return;
      this.viewerWindow = null;
      this.viewerReady = false;
      this.server.leave();
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.loadFile(path.join(__dirname, 'classroom-view.html')).then(() => {
      if (this.viewerWindow !== win || win.isDestroyed()) return;
      this.viewerReady = true;
      win.webContents.send('classroom-view-message', { type: 'accepted', name: state.name });
      for (const message of this.viewerQueue.splice(0)) win.webContents.send('classroom-view-message', message);
    }).catch((error) => {
      console.error('[classroom] could not open student view:', error.message);
      this.server.leave();
    });
  }

  _sendViewer(message) {
    const win = this.viewerWindow;
    if (!win || win.isDestroyed()) return;
    if (!this.viewerReady) this.viewerQueue.push(message);
    else win.webContents.send('classroom-view-message', message);
  }

  _ensureWorker() {
    if (this.worker && !this.worker.isDestroyed()) return;
    this.workerReady = false;
    this.queue = [];
    const worker = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'classroom-capture-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.worker = worker;
    worker.on('closed', () => {
      if (this.worker !== worker) return;
      this.worker = null;
      this.workerReady = false;
      this.captureReady = false;
      if (this.broadcastStarting || this.server.view().sharing) {
        this.broadcastStarting = false;
        this.shareError = 'Screen capture stopped unexpectedly';
        this.server.setSharing(false);
        this.onChange();
      }
    });
    this.workerStartupError = null;
    worker.loadFile(path.join(__dirname, 'classroom-capture.html')).catch((error) => {
      if (this.worker !== worker) return;
      this.workerStartupError = error;
      this.broadcastStarting = false;
      this.shareError = `Could not load screen capture: ${error.message}`;
      this.onChange();
      worker.destroy();
    });
  }

  _fromWorker(event) {
    return this.worker && !this.worker.isDestroyed() && event.sender === this.worker.webContents;
  }

  _sendWorker(message) {
    if (!this.worker || this.worker.isDestroyed()) return false;
    if (!this.workerReady) {
      this.queue.push(message);
      return true;
    }
    this.worker.webContents.send(CHANNELS.command, message);
    return true;
  }

  _waitForWorker() {
    if (this.workerReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => {
        if (this.workerReady) return resolve();
        if (this.workerStartupError) return reject(this.workerStartupError);
        if (Date.now() >= deadline || !this.worker || this.worker.isDestroyed()) return reject(new Error('Screen capture window did not start'));
        setTimeout(check, 25);
      };
      check();
    });
  }

  _workerEvent(message) {
    if (message.type === 'file-started' || message.type === 'file-chunk-sent' || message.type === 'file-finished') {
      const key = this._fileWaitKey(message.type, message.fileId, message.sequence);
      const waiter = this.fileWaiters.get(key);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.fileWaiters.delete(key);
        waiter.resolve(message);
      }
    } else if (message.type === 'file-error') {
      const key = this._fileWaitKey(message.ackType, message.fileId, message.sequence);
      const waiter = this.fileWaiters.get(key);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.fileWaiters.delete(key);
        waiter.reject(new Error(String(message.message || 'Could not send classroom file').slice(0, 240)));
      }
    } else if (message.type === 'captured') {
      if (message.runId !== this.broadcastRun || !this.broadcastStarting) return;
      this.captureReady = true;
      this.broadcastStarting = false;
      this.shareError = '';
      this.server.setSharing(true);
      for (const student of this.server.view().students) this._sendWorker({ type: 'add', id: student.id });
    } else if (message.type === 'signal' && typeof message.id === 'string') {
      this.server.sendTo(message.id, { type: 'signal', signal: message.signal });
    } else if (message.type === 'error') {
      if (message.runId !== this.broadcastRun) return;
      this.captureReady = false;
      this.broadcastStarting = false;
      this.shareError = String(message.message || 'Screen capture failed').slice(0, 240);
      this.server.setSharing(false);
    } else if (message.type === 'peer-error') {
      this.shareError = String(message.message || 'A student could not connect').slice(0, 240);
      this.onChange();
    } else if (message.type === 'stopped') {
      if (message.runId !== this.broadcastRun) return;
      this.captureReady = false;
      this.broadcastStarting = false;
      this.server.setSharing(false);
    }
  }

  _fileWaitKey(type, fileId, sequence) {
    return `${type}:${fileId}:${Number.isInteger(sequence) ? sequence : ''}`;
  }

  _fileCommand(command, ackType, fileId, sequence) {
    const key = this._fileWaitKey(ackType, fileId, sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fileWaiters.delete(key);
        reject(new Error('Timed out while sending a classroom file'));
      }, FILE_COMMAND_TIMEOUT_MS);
      this.fileWaiters.set(key, { resolve, reject, timer });
      if (!this._sendWorker(command)) {
        clearTimeout(timer);
        this.fileWaiters.delete(key);
        reject(new Error('Screen sharing is not ready'));
      }
    });
  }

  _rejectFileWaiters(error) {
    for (const waiter of this.fileWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.fileWaiters.clear();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    ipcMain.removeListener(CHANNELS.ready, this._readyListener);
    ipcMain.removeListener(CHANNELS.event, this._eventListener);
    ipcMain.removeListener(CHANNELS.viewerSignal, this._viewerSignalListener);
    ipcMain.removeListener(CHANNELS.viewerLeave, this._viewerLeaveListener);
    this._rejectFileWaiters(new Error('Classroom is shutting down'));
    await this.stopRoom();
    const worker = this.worker;
    this.worker = null;
    if (worker && !worker.isDestroyed()) worker.destroy();
    for (const win of this.joinWindows) if (!win.isDestroyed()) win.destroy();
    this.joinWindows.clear();
    if (this.viewerWindow && !this.viewerWindow.isDestroyed()) this.viewerWindow.destroy();
    this.viewerWindow = null;
    if (typeof this.server.close === 'function') await this.server.close();
  }
}

module.exports = { ClassroomController };
