// Zantexa Link — Copyright (C) 2026 inukaasith. GPL-3.0, see LICENSE.
'use strict';

UI.tab({
  id: 'classroom',
  order: 90,
  title: 'Classroom',
  heading: 'Classroom',
  icon: 'multi',
  color: 'linear-gradient(#ff9f0a, #c36a00)',
  desc: 'Teacher-approved screen sharing over connected Zantexa Link apps.',
  bottom: false,
  build(body) {
    const { api, el } = UI;
    let current = { classroom: {} };
    const note = UI.note('info', '');
    const error = UI.note('bad', '');
    const start = UI.button('Start class', async () => {
      start.disabled = true;
      try {
        const state = await api.classroomStart();
        if (!state || state.running !== true) throw new Error('The classroom server did not start.');
      } catch (e) {
        console.error('[classroom] could not start:', e);
        error.set(e.message || 'Could not start the classroom.');
      }
      finally { start.disabled = false; }
    }, 'small primary');
    const stop = UI.button('End class', async () => {
      stop.disabled = true;
      try { await api.classroomStop(); } catch (e) { error.set(e.message || 'Could not end the classroom.'); }
      finally { stop.disabled = false; }
    }, 'small');
    const code = el('strong', { class: 'code' });
    const address = el('span', { class: 'value' });
    const copyAddress = UI.button('Copy join address', () => api.copyText(joinUrl(current.classroom)), 'small');
    const copyCode = UI.button('Copy code', () => api.copyText(current.classroom.code || ''), 'small');
    const codeRow = UI.row('Room code', 'Give this temporary code only to your class.', [code, copyCode]);
    const addressRow = UI.row('Join address', 'Students must use the same Wi-Fi or hotspot.', [address, copyAddress]);
    const roomCard = UI.card('Teacher', [codeRow, addressRow]);

    const display = UI.select([], () => {});
    let shareRequesting = false;
    const share = UI.button('Share screen with class', async () => {
      if (shareRequesting) return;
      shareRequesting = true;
      share.disabled = true;
      try { await api.classroomShare(display.el.value); } catch (e) { error.set(e.message || 'Could not start screen sharing.'); }
      finally {
        shareRequesting = false;
        share.disabled = !!(current.classroom || {}).starting;
      }
    }, 'small primary');
    const stopShare = UI.button('Stop screen sharing', async () => {
      stopShare.disabled = true;
      try { await api.classroomStopShare(); } catch (e) { error.set(e.message || 'Could not stop screen sharing.'); }
      finally { stopShare.disabled = false; }
    }, 'small');
    const displayRow = UI.row('Display', 'The selected display is sent to every accepted student.', [display, share, stopShare]);
    let fileRequesting = false;
    const fileStatus = UI.note('info', '');
    const shareFiles = UI.button('Choose files and share', async () => {
      if (fileRequesting) return;
      fileRequesting = true;
      shareFiles.disabled = true;
      error.set('');
      try {
        const result = await api.classroomShareFiles();
        if (result && !result.canceled) {
          fileStatus.set(`Shared ${result.files.length} file${result.files.length === 1 ? '' : 's'} with ${result.files[0] ? result.files[0].recipients : 0} student${result.files[0] && result.files[0].recipients === 1 ? '' : 's'}. Students can choose which files to save.`);
        }
      } catch (e) { error.set(e.message || 'Could not share classroom files.'); }
      finally {
        fileRequesting = false;
        shareFiles.disabled = false;
      }
    }, 'small');
    const filesRow = UI.row('Class files', 'Files are sent to all approved students while screen sharing is active (100 MB per file).', [shareFiles]);
    const pending = el('div');
    const students = el('div');
    const teacherCard = UI.card('Manage class', [displayRow, filesRow, fileStatus, UI.row('Join requests', 'Only accepted students can see the shared screen and class files.', []), pending, UI.row('In class', '', []), students]);

    const joinAddress = el('input', { type: 'text', placeholder: '192.168.1.20:43157', autocomplete: 'off', spellcheck: false, attrs: { 'aria-label': 'Teacher address and port' } });
    const joinCode = el('input', { type: 'text', placeholder: '6-digit code', maxLength: 6, inputMode: 'numeric', autocomplete: 'one-time-code', attrs: { 'aria-label': 'Classroom code' } });
    const openJoin = UI.button('Join in this app', async () => {
      try {
        const ok = await api.classroomJoin(joinAddress.value.trim(), joinCode.value.trim());
        if (ok === false) error.set('Enter the teacher’s private-network address and six-digit room code.');
      } catch (e) { error.set(e.message || 'Could not open the classroom.'); }
    }, 'small primary');
    const joinCard = UI.card('Join as a student', [
      UI.row('Teacher address', 'Enter the address shown on the teacher’s Classroom page.', [joinAddress]),
      UI.row('Room code', '', [joinCode, openJoin]),
      UI.note('info', 'You can also open the teacher’s join address in any browser; no student-app installation is needed.'),
    ]);
    const studentName = el('input', { type: 'text', placeholder: 'Your name', maxLength: 48, autocomplete: 'name', attrs: { 'aria-label': 'Your name' } });
    const meshRooms = el('div');
    const joinedStatus = el('div');
    const roomCodeInputs = new Map();
    const leaveClass = UI.button('Leave class', () => api.classroomLeave(), 'small');
    const meshJoinCard = UI.card('Join an active class', [
      UI.row('Your name', '', [studentName]),
      meshRooms,
      UI.row('Current request', '', [joinedStatus, leaveClass]),
    ]);

    body.append(note, error, UI.card('', [UI.row('Class status', '', [start, stop])]), roomCard, teacherCard, joinCard, meshJoinCard);
    let displayKey = '';

    function render(s) {
      const c = s && s.classroom && typeof s.classroom === 'object' ? s.classroom : s || {};
      current = { classroom: c };
      const meshMode = c.transport === 'mesh';
      note.set(meshMode
        ? 'Students must first connect to the teacher in Multi-device. Classroom uses the encrypted app connection, but screen video needs a direct IP network path between devices; a Bluetooth-only link cannot carry the screen. Up to 9 direct student links.'
        : 'LAN Classroom works only when devices can reach each other on the same Wi-Fi or hotspot. Its local page and code are not encrypted; use a trusted network.');
      error.set(c.shareError || '');
      start.hidden = !!c.running;
      stop.hidden = !c.running;
      roomCard.hidden = !c.running;
      teacherCard.hidden = !c.running;
      addressRow.hidden = meshMode;
      code.textContent = c.code || '';
      const endpoints = (c.addresses || []).map((ip) => `http://${ip}:${c.port}/`);
      address.textContent = endpoints.length ? endpoints.join('  |  ') : 'No local network address found';
      copyAddress.disabled = !endpoints.length;
      copyCode.disabled = !c.code;
      displayRow.hidden = !c.running;
      share.hidden = !c.running || c.sharing;
      share.disabled = !!c.starting || shareRequesting;
      if (c.starting) share.textContent = 'Starting screen share…';
      else share.textContent = 'Share screen with class';
      stopShare.hidden = !c.running || !c.sharing;
      filesRow.hidden = !c.running || !c.sharing || !(c.students || []).length;
      shareFiles.disabled = fileRequesting;
      display.disabled = c.sharing;
      start.disabled = !!c.joined;
      joinCard.hidden = meshMode;
      meshJoinCard.hidden = !meshMode;
      leaveClass.hidden = !meshMode || !c.joined;
      if (meshMode && c.joined) {
        joinedStatus.textContent = `${c.joined.name}: ${c.joined.state === 'accepted' ? 'accepted; screen opens in a separate window' : 'request sent; waiting for teacher approval'}`;
      } else {
        joinedStatus.textContent = 'No class request';
      }
      const availableRooms = c.rooms || [];
      const activeRoomKeys = new Set(availableRooms.map((room) => `${room.peerId}:${room.roomId}`));
      for (const key of roomCodeInputs.keys()) if (!activeRoomKeys.has(key)) roomCodeInputs.delete(key);
      const roomRows = availableRooms.map((room) => {
        const key = `${room.peerId}:${room.roomId}`;
        if (!roomCodeInputs.has(key)) roomCodeInputs.set(key,
          el('input', { type: 'text', placeholder: 'Teacher’s 6-digit code', maxLength: 6, inputMode: 'numeric', autocomplete: 'one-time-code', attrs: { 'aria-label': `Code for ${room.name}` } }));
        const codeInput = roomCodeInputs.get(key);
        const join = UI.button('Request to join', async () => {
          if (!/^\d{6}$/.test(codeInput.value.trim())) {
            error.set('Enter the six-digit classroom code shown on the teacher’s screen.');
            return;
          }
          try {
            const ok = await api.classroomJoinPeer(room.peerId, room.roomId, codeInput.value.trim(), studentName.value.trim());
            if (ok === false) error.set('Connect to this teacher in Multi-device first, then enter their classroom code.');
          } catch (e) { error.set(e.message || 'Could not request to join this class.'); }
        }, 'small primary');
        join.disabled = !!c.joined || !!c.running;
        return UI.row(room.name, room.sharing ? 'Teacher is sharing a screen' : 'Waiting for the teacher to share', [codeInput, join]);
      });
      meshRooms.replaceChildren(...(roomRows.length ? roomRows : [UI.row('No active class found', 'Connect to your teacher in Multi-device, then ask them to start a class.', [])]));
      const sourcesKey = JSON.stringify(c.displays || []);
      if (sourcesKey !== displayKey) {
        displayKey = sourcesKey;
        display.options((c.displays || []).map((d) => ({ value: d.id, label: d.name })));
        if ((c.displays || []).length) display.set(c.displays[0].id);
      }
      const requests = (c.pending || []).map((p) => UI.row(p.name, 'Waiting for teacher approval', [
        UI.button('Accept', () => api.classroomDecide(p.id, true), 'small primary'),
        UI.button('Decline', () => api.classroomDecide(p.id, false), 'small'),
      ]));
      pending.replaceChildren(...(requests.length ? requests : [UI.row('No requests', '', [])]));
      const connected = (c.students || []).map((p) => UI.row(p.name, c.sharing ? 'Watching the teacher’s screen' : 'In class', [
        UI.button('Remove', () => api.classroomDecide(p.id, false), 'small'),
      ]));
      students.replaceChildren(...(connected.length ? connected : [UI.row('No students yet', '', [])]));
    }

    api.classroomDisplays().then((sources) => {
      if (!Array.isArray(sources)) return;
      display.options(sources.map((d) => ({ value: d.id, label: d.name })));
      if (sources.length) display.set(sources[0].id);
    }).catch((e) => error.set(e.message || 'Could not list displays.'));
    api.classroomState().then(render).catch((e) => error.set(e.message || 'Could not read classroom state.'));
    api.onClassroom(render);

    return render;
  },
});

function joinUrl(c) {
  const address = c && c.addresses && c.addresses[0];
  return address && c.port ? `http://${address}:${c.port}/` : '';
}
