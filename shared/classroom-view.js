// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
'use strict';

(() => {
  const api = window.classroomView;
  const heading = document.getElementById('heading');
  const status = document.getElementById('status');
  const video = document.getElementById('screen');
  const filesSection = document.getElementById('files-section');
  const files = document.getElementById('files');
  const leave = document.getElementById('leave');
  const fileReceiver = new window.ClassroomFileTransfer.Receiver();
  let pc = null;
  let pendingIce = [];

  function showFile(file) {
    const blob = new Blob(file.chunks, { type: file.mimeType });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = file.name;
    link.textContent = `Save ${link.download}`;
    link.addEventListener('click', () => setTimeout(() => URL.revokeObjectURL(url), 60_000), { once: true });
    files.append(link);
    filesSection.hidden = false;
    status.textContent = `The teacher shared ${link.download}. Choose Save to download it.`;
  }

  function fileMessage(data) {
    if (typeof data === 'string') {
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (message.type === 'file-start') {
        if (!fileReceiver.start(message.file)) {
          status.textContent = 'The teacher sent an invalid file.';
          fileReceiver.clear();
          return;
        }
        status.textContent = `Receiving ${window.ClassroomFileTransfer.metadata(message.file).name}…`;
      } else if (message.type === 'file-end') {
        const file = fileReceiver.finish(message.fileId);
        if (file) showFile(file);
        else {
          status.textContent = 'The classroom file was incomplete.';
          fileReceiver.clear();
        }
      } else if (message.type === 'file-abort' && fileReceiver.abort(message.fileId)) {
        status.textContent = 'The teacher stopped sending a file.';
      }
      return;
    }

    if (!fileReceiver.append(data)) {
      status.textContent = 'The classroom file could not be received.';
      fileReceiver.clear();
      return;
    }
  }

  function attachFileChannel(channel) {
    if (channel.label !== 'classroom-files') return;
    channel.binaryType = 'arraybuffer';
    channel.onmessage = (event) => fileMessage(event.data);
    channel.onerror = () => { status.textContent = 'The file connection ended unexpectedly.'; };
  }

  function closePeer() {
    if (pc) pc.close();
    pc = null;
    pendingIce = [];
    video.srcObject = null;
    video.hidden = true;
    fileReceiver.clear();
  }

  async function signal(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'offer' && typeof message.sdp === 'string') {
      closePeer();
      const current = new RTCPeerConnection({ iceServers: [] });
      pc = current;
      current.ontrack = (event) => {
        if (pc !== current) return;
        video.srcObject = event.streams[0] || new MediaStream([event.track]);
        video.hidden = false;
        status.textContent = 'Connected to the teacher’s screen.';
        video.play().catch(() => {});
      };
      current.ondatachannel = (event) => attachFileChannel(event.channel);
      current.onicecandidate = (event) => {
        if (event.candidate && pc === current) api.signal({ type: 'ice', candidate: event.candidate.toJSON() });
      };
      current.onconnectionstatechange = () => {
        if (pc === current && ['failed', 'disconnected', 'closed'].includes(current.connectionState)) {
          status.textContent = 'The screen connection ended.';
        }
      };
      await current.setRemoteDescription({ type: 'offer', sdp: message.sdp });
      for (const candidate of pendingIce.splice(0)) await current.addIceCandidate(candidate).catch(() => {});
      const answer = await current.createAnswer();
      await current.setLocalDescription(answer);
      api.signal({ type: 'answer', sdp: current.localDescription.sdp });
    } else if (message.type === 'ice' && message.candidate) {
      if (pc && pc.remoteDescription) await pc.addIceCandidate(message.candidate).catch(() => {});
      else pendingIce.push(message.candidate);
    }
  }

  api.onMessage((message) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'accepted') {
      heading.textContent = `Classroom — ${String(message.name || 'Teacher').slice(0, 64)}`;
      status.textContent = 'Accepted. Waiting for the teacher to share the screen…';
    } else if (message.type === 'signal') {
      signal(message.signal).catch((error) => { status.textContent = `Could not connect: ${error.message}`; });
    } else if (message.type === 'ended') {
      closePeer();
      status.textContent = 'The teacher ended the class.';
    }
  });

  leave.addEventListener('click', () => {
    api.leave();
    closePeer();
    status.textContent = 'You left the class.';
    leave.disabled = true;
  });
  window.addEventListener('beforeunload', () => api.leave());
})();
