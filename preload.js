const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tirproc", {
  embedded: true,
  openChat: (text) => ipcRenderer.invoke("open-chat", text),
  readClipboard: () => ipcRenderer.invoke("read-clipboard")
});
