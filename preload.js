const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tirproc", {
  embedded: true,
  openQwen: (bounds) => ipcRenderer.invoke("open-deepseek", bounds),
  sendPrompt: (text) => ipcRenderer.invoke("send-prompt", text),
  readAnswer: () => ipcRenderer.invoke("read-answer"),
  hideBrowser: () => ipcRenderer.invoke("hide-browser"),
  clearQwen: () => ipcRenderer.invoke("clear-deepseek"),
  openExternal: (text) => ipcRenderer.invoke("open-external", text)
});
