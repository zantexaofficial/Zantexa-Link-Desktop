// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
'use strict';

(() => {
  const form = document.getElementById('join');
  const code = document.getElementById('code');
  const name = document.getElementById('name');
  const status = document.getElementById('status');
  const video = document.getElementById('screen');
  const filesSection = document.getElementById('files-section');
  const files = document.getElementById('files');
  const fileReceiver = new window.ClassroomFileTransfer.Receiver();
  const presetCode = new URLSearchParams(location.search).get('code');
  if (/^\d{6}$/.test(presetCode || '')) code.value = presetCode;
  let socket = null;
  let pc = null;
  let pendingIce = [];
  let finalStatus = '';

  const say = (text) => { status.textContent = text; };
  const send = (message) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

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
    say(`The teacher shared ${link.download}. Choose Save to download it.`);
  }

  function onFileMessage(data) {
    if (typeof data === 'string') {
      let message;
      try { message = JSON.parse(data); } catch { return; }
      if (message.type === 'file-start') {
        if (!fileReceiver.start(message.file)) {
          say('The teacher sent an invalid file.');
          fileReceiver.clear();
          return;
        }
        say(`Receiving ${window.ClassroomFileTransfer.metadata(message.file).name}…`);
      } else if (message.type === 'file-end') {
        const file = fileReceiver.finish(message.fileId);
        if (file) showFile(file);
        else {
          say('The classroom file was incomplete.');
          fileReceiver.clear();
        }
      } else if (message.type === 'file-abort' && fileReceiver.abort(message.fileId)) {
        say('The teacher stopped sending a file.');
      }
      return;
    }

    if (!fileReceiver.append(data)) {
      say('The classroom file could not be received.');
      fileReceiver.clear();
    }
  }

  async function onSignal(signal) {
    if (signal.type === 'offer') {
      if (pc) pc.close();
      const peer = new RTCPeerConnection({ iceServers: [] });
      pc = peer;
      peer.ontrack = (event) => {
        video.srcObject = event.streams[0] || new MediaStream([event.track]);
        video.hidden = false;
        say('Connected to the teacher’s screen.');
        video.play().catch(() => {});
      };
      peer.ondatachannel = (event) => {
        const channel = event.channel;
        if (channel.label !== 'classroom-files') return;
        channel.binaryType = 'arraybuffer';
        channel.onmessage = (message) => onFileMessage(message.data);
        channel.onerror = () => say('The file connection ended unexpectedly.');
      };
      peer.onicecandidate = (event) => event.candidate && send({ type: 'signal', signal: { type: 'ice', candidate: event.candidate.toJSON() } });
      peer.onconnectionstatechange = () => {
        if (pc === peer && ['failed', 'disconnected', 'closed'].includes(peer.connectionState)) {
          fileReceiver.clear();
          say('The screen connection ended.');
        }
      };
      await peer.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
      for (const candidate of pendingIce.splice(0)) await peer.addIceCandidate(candidate).catch(() => {});
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      send({ type: 'signal', signal: { type: 'answer', sdp: peer.localDescription.sdp } });
    } else if (signal.type === 'ice' && signal.candidate) {
      if (pc && pc.remoteDescription) await pc.addIceCandidate(signal.candidate).catch(() => {});
      else pendingIce.push(signal.candidate);
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (socket && socket.readyState < WebSocket.CLOSING) return;
    finalStatus = '';
    pendingIce = [];
    if (pc) pc.close();
    pc = null;
    fileReceiver.clear();
    files.replaceChildren();
    filesSection.hidden = true;
    video.srcObject = null;
    video.hidden = true;
    const pin = code.value.trim();
    if (!/^\d{6}$/.test(pin)) return say('Enter the six-digit room code.');
    const wsUrl = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/classroom-signal';
    socket = new WebSocket(wsUrl);
    say('Connecting to the teacher…');
    socket.addEventListener('open', () => send({ type: 'join', code: pin, name: name.value.trim() }));
    socket.addEventListener('message', async (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'hello') return;
      if (msg.type === 'pending') say('Join request sent. Wait for the teacher to accept.');
      else if (msg.type === 'accepted') say('Accepted. Waiting for the teacher to share the screen…');
      else if (msg.type === 'declined') { finalStatus = 'The teacher declined your request.'; say(finalStatus); }
      else if (msg.type === 'error') {
        finalStatus = ({ code: 'Incorrect room code.', full: 'The room is full.', rate_limited: 'Too many attempts. Wait a minute and try again.', message: 'Invalid request.' })[msg.reason] || 'Could not join this room.';
        say(finalStatus);
        socket.close();
      }
      else if (msg.type === 'signal') {
        try { await onSignal(msg.signal); } catch (e) { say('Could not connect to the shared screen: ' + e.message); }
      }
    });
    socket.addEventListener('close', () => {
      if (pc) pc.close();
      pc = null;
      fileReceiver.clear();
      video.srcObject = null;
      video.hidden = true;
      say(finalStatus || 'Disconnected from the classroom.');
    });
    socket.addEventListener('error', () => {
      finalStatus = 'Cannot reach the teacher. Check the Wi-Fi and address.';
      say(finalStatus);
    });
  });
})();
