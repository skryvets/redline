const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('redline', {
  openProject: () => ipcRenderer.invoke('project:open'),
  loadProject: () => ipcRenderer.invoke('project:load'),
  saveMarkers: (markers) => ipcRenderer.invoke('markers:save', markers),
  start: (request) => ipcRenderer.invoke('claude:start', request),
  stop: () => ipcRenderer.invoke('claude:stop'),
  onEvent: (listener) => ipcRenderer.on('claude:event', (_event, payload) => listener(payload)),
});
