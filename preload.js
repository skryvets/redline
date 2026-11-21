const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('redline', {
  openProject: () => ipcRenderer.invoke('project:open'),
  selectProject: (dir) => ipcRenderer.invoke('project:select', dir),
  removeProject: (dir) => ipcRenderer.invoke('project:remove', dir),
  loadProject: () => ipcRenderer.invoke('project:load'),
  saveMarkers: (markers) => ipcRenderer.invoke('markers:save', markers),
  exportRender: (render) => ipcRenderer.invoke('render:export', render),
  start: (request) => ipcRenderer.invoke('claude:start', request),
  stop: () => ipcRenderer.invoke('claude:stop'),
  loadAbout: () => ipcRenderer.invoke('about:load'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onAbout: (listener) => ipcRenderer.on('about:open', () => listener()),
  onUpdateProgress: (listener) => ipcRenderer.on('update:progress', (_event, ratio) => listener(ratio)),
  onEvent: (listener) => ipcRenderer.on('claude:event', (_event, payload) => listener(payload)),
});
