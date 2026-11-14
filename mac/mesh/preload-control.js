// Zantexa Link — Copyright (C) 2026 inukaasith, Erdoğan Yeşil. GPL-3.0, see LICENSE.
// Small API for the control window: getState/onState plus one call per action in ipc.js.
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const ACTIONS = [
  'setSharing', 'setStreamTarget', 'setStreamInput', 'selectDisplay', 'setDisplayMode', 'setVirtual', 'setStreamMaxHeight',
  'setBitrate', 'setKvm', 'setApp', 'setAudio', 'setTerminal', 'openSharingSettings', 'setFiles', 'pickDropFolder', 'resetDropFolder', 'revealDrop', 'setSmb', 'setShareMac', 'chooseShareFolder', 'stopSharingFolder', 'openPcShare', 'setApps', 'setReceive', 'showPcView', 'closePcView', 'setPcApps', 'listPcApps', 'openPcApp', 'openPcShell', 'setScreenSound', 'setKeys', 'setClipboard', 'copyHistory', 'clearHistory', 'setTab', 'setSharingOpts', 'remoteScreen', 'wakePeer', 'setWakeOnLan',
  'pairRespond', 'forget', 'openSettings', 'relaunch', 'setMulti',
  'keepPcAppInDock', 'sendFiles', 'chooseSendFiles', 'setNotifs', 'muteNotifApp', 'allowFullDisk',
  'connectAddress', 'pairWith', 'selectPeer', 'forgetPeer', 'confirmGuestCode', 'cancelGuestPair', 'forgetHost',
  'refreshDiscovery', 'copyText', 'allowPermission', 'skipSetup', 'connectPhone', 'disconnectPhone', 'setPhone',
  'phonePair', 'phoneScreen', 'phoneOpenApp', 'phoneCloseView', 'phoneRetry', 'phoneInstallFull', 'phoneMount',
  'phoneUnmount', 'setMount', 'phoneAppMenu', 'deviceDo', 'setOverview', 'setChats', 'notifReply', 'setUpdates', 'skipUpdate', 'unskipUpdate', 'checkUpdates', 'openUpdate',
  'openLink', 'setLayoutCell', 'removeFromLayout', 'disconnect', 'connectAgain', 'setNet', 'netJoinHotspot',
  'netCancel', 'netWifi', 'hub',
];

const api = {
  getState: () => ipcRenderer.invoke('getState'),
  classroomState: () => ipcRenderer.invoke('classroomState'),
  classroomStart: () => ipcRenderer.invoke('classroomStart'),
  classroomStop: () => ipcRenderer.invoke('classroomStop'),
  classroomDisplays: () => ipcRenderer.invoke('classroomDisplays'),
  classroomShare: (id) => ipcRenderer.invoke('classroomShare', id),
  classroomShareFiles: () => ipcRenderer.invoke('classroomShareFiles'),
  classroomStopShare: () => ipcRenderer.invoke('classroomStopShare'),
  classroomDecide: (id, accept) => ipcRenderer.invoke('classroomDecide', id, accept),
  classroomJoin: (address, code) => ipcRenderer.invoke('classroomJoin', address, code),
  classroomJoinPeer: (peerId, roomId, code, name) => ipcRenderer.invoke('classroomJoinPeer', peerId, roomId, code, name),
  classroomLeave: () => ipcRenderer.invoke('classroomLeave'),
  onClassroom: (fn) => ipcRenderer.on('classroom-state', (_e, s) => fn(s)),
  phoneAssets: () => ipcRenderer.invoke('phoneAssets'),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
  onShowUpdate: (fn) => ipcRenderer.on('show-update', () => fn()),
  onHub: (fn) => ipcRenderer.on('hub', (_e, m) => fn(m)), // the phone's answers for Calls, Messages and Photos
  onGo: (fn) => ipcRenderer.on('go', (_e, tab) => fn(tab)), // show a page (the call window's Calls)
  pathsOf: (files) => [...files].map((f) => webUtils.getPathForFile(f)).filter(Boolean), // dropped files -> paths
};
for (const name of ACTIONS) api[name] = (arg) => ipcRenderer.send(name, arg);

contextBridge.exposeInMainWorld('macshare', api);
