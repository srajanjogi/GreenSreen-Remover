const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectVideoFile: () => ipcRenderer.invoke('select-video-file'),
  selectImageFile: () => ipcRenderer.invoke('select-image-file'),
  saveVideoFile: () => ipcRenderer.invoke('save-video-file'),
  processVideo: (options) => ipcRenderer.invoke('process-video', options),
  getVideoUrl: (filePath) => ipcRenderer.invoke('get-video-url', filePath),
  getTempVideoPath: () => ipcRenderer.invoke('get-temp-video-path'),
  detectGreenColor: (videoPath) => ipcRenderer.invoke('detect-green-color', videoPath),
  onProcessProgress: (callback) => {
    ipcRenderer.on('process-progress', (event, data) => callback(data));
  },
  removeProcessProgressListener: () => {
    ipcRenderer.removeAllListeners('process-progress');
  }
});
