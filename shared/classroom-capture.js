// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
'use strict';

(() => {
  const api = window.classroomCapture;
  const peers = new Map();
  const activeFiles = new Map();
  const { MAX_FILE_BYTES, CHUNK_BYTES: FILE_CHUNK_BYTES } = window.ClassroomFileTransfer;
  const FILE_BUFFER_LIMIT = 256 * 1024;
  let stream = null;
  let captureRun = 0;
  let activeRunId = 0;

  const send = (message) => api.event(message);

  async function capture(sourceId, runId) {
    const run = ++captureRun;
    activeRunId = runId;
    stopPeers();
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 3840,
          maxHeight: 2160,
          maxFrameRate: 30,
        } },
      });
      if (run !== captureRun) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      track.contentHint = 'detail';
      track.onended = () => run === captureRun && stop(activeRunId);
      send({ type: 'captured', runId });
    } catch (error) {
      if (run === captureRun) send({ type: 'error', runId, message: `Screen capture failed: ${error.message}` });
    }
  }

  function stopPeers() {
    for (const peer of peers.values()) {
      peer.pc.close();
      peer.track.stop();
    }
    peers.clear();
    activeFiles.clear();
  }

  async function add(id) {
    if (!stream || peers.has(id)) return;
    const pc = new RTCPeerConnection({ iceServers: [] });
    const track = stream.getVideoTracks()[0].clone();
    const fileChannel = pc.createDataChannel('classroom-files', { ordered: true });
    const peer = { pc, pending: [], track, fileChannel };
    peers.set(id, peer);
    const sender = pc.addTrack(track, new MediaStream());
    try {
      const parameters = sender.getParameters();
      if (!parameters.encodings || !parameters.encodings.length) parameters.encodings = [{}];
      parameters.encodings[0].maxBitrate = 1_500_000;
      parameters.encodings[0].maxFramerate = 20;
      await sender.setParameters(parameters);
      pc.onicecandidate = (event) => {
        if (event.candidate && peers.get(id) === peer) send({ type: 'signal', id, signal: { type: 'ice', candidate: event.candidate.toJSON() } });
      };
      pc.onconnectionstatechange = () => {
        if (peers.get(id) === peer && ['failed', 'closed'].includes(pc.connectionState)) remove(id);
      };
      const offer = await pc.createOffer();
      if (peers.get(id) !== peer) return;
      await pc.setLocalDescription(offer);
      send({ type: 'signal', id, signal: { type: 'offer', sdp: pc.localDescription.sdp } });
    } catch (error) {
      remove(id);
      send({ type: 'peer-error', message: `Could not start a student stream: ${error.message}` });
    }
  }

  async function signal(id, message) {
    const peer = peers.get(id);
    if (!peer || !message) return;
    try {
      if (message.type === 'answer' && typeof message.sdp === 'string') {
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: message.sdp });
        for (const candidate of peer.pending.splice(0)) await peer.pc.addIceCandidate(candidate).catch(() => {});
        peer.pending = null;
      } else if (message.type === 'ice' && message.candidate) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(message.candidate).catch(() => {});
        else if (peer.pending) peer.pending.push(message.candidate);
      }
    } catch (error) {
      send({ type: 'peer-error', message: `Student connection failed: ${error.message}` });
    }
  }

  function remove(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    peer.pc.close();
    peer.track.stop();
  }

  function fileError(message, error) {
    const ackType = message.type === 'file-start' ? 'file-started'
      : message.type === 'file-chunk' ? 'file-chunk-sent' : 'file-finished';
    send({
      type: 'file-error',
      fileId: message.fileId || (message.file && message.file.id),
      ackType,
      sequence: message.sequence,
      message: error.message,
    });
  }

  async function sendFileCommand(message) {
    const fileId = message.fileId || (message.file && message.file.id);
    if (message.type === 'file-start') {
      const file = message.file;
      if (!window.ClassroomFileTransfer.metadata(file)
        || !Array.isArray(message.recipients) || !message.recipients.length
        || activeFiles.has(file.id)) throw new Error('Invalid classroom file');
      const targets = message.recipients.map((id) => {
        const peer = peers.get(id);
        if (!peer || peer.fileChannel.readyState !== 'open') throw new Error('An approved student is not ready to receive files');
        return { id, channel: peer.fileChannel };
      });
      activeFiles.set(file.id, { file, targets, sent: 0, sequence: 0 });
      for (const target of targets) {
        target.channel.send(JSON.stringify({ type: 'file-start', file }));
      }
      send({ type: 'file-started', fileId, recipients: targets.length });
      return;
    }

    const transfer = activeFiles.get(fileId);
    if (!transfer) throw new Error('Classroom file transfer is no longer active');
    if (message.type === 'file-chunk') {
      const data = message.data;
      if (!Number.isInteger(message.sequence) || message.sequence !== transfer.sequence
        || !ArrayBuffer.isView(data) || data.byteLength < 1 || data.byteLength > FILE_CHUNK_BYTES
        || transfer.sent + data.byteLength > transfer.file.size) throw new Error('Invalid classroom file chunk');
      for (const target of transfer.targets) {
        const deadline = Date.now() + 30_000;
        while (target.channel.readyState === 'open' && target.channel.bufferedAmount > FILE_BUFFER_LIMIT) {
          if (Date.now() >= deadline) throw new Error('Classroom file transfer stalled');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        if (target.channel.readyState !== 'open') throw new Error('A student disconnected during file transfer');
        target.channel.send(data);
      }
      transfer.sent += data.byteLength;
      transfer.sequence++;
      send({ type: 'file-chunk-sent', fileId, sequence: message.sequence });
      return;
    }

    if (message.type === 'file-end') {
      if (transfer.sent !== transfer.file.size) throw new Error('Classroom file is incomplete');
      for (const target of transfer.targets) target.channel.send(JSON.stringify({ type: 'file-end', fileId }));
      activeFiles.delete(fileId);
      send({ type: 'file-finished', fileId });
    } else if (message.type === 'file-abort') {
      for (const target of transfer.targets) {
        if (target.channel.readyState === 'open') target.channel.send(JSON.stringify({ type: 'file-abort', fileId }));
      }
      activeFiles.delete(fileId);
    }
  }

  function stop(runId = activeRunId) {
    captureRun++;
    stopPeers();
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    activeRunId = runId;
    send({ type: 'stopped', runId });
  }

  api.onCommand(async (message) => {
    if (!message || typeof message !== 'object') return;
    try {
      if (message.type === 'capture' && typeof message.sourceId === 'string') await capture(message.sourceId, message.runId);
      else if (message.type === 'add' && typeof message.id === 'string') await add(message.id);
      else if (message.type === 'remove' && typeof message.id === 'string') remove(message.id);
      else if (message.type === 'signal' && typeof message.id === 'string') await signal(message.id, message.signal);
      else if (message.type === 'stop' && Number.isInteger(message.runId)) stop(message.runId);
      else if (['file-start', 'file-chunk', 'file-end', 'file-abort'].includes(message.type)) await sendFileCommand(message);
    } catch (error) {
      fileError(message, error);
    }
  });

  api.ready();
})();
