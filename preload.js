const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tirproc", {
  embedded: true,
  openDeepSeek: (bounds) => ipcRenderer.invoke("open-deepseek", bounds),
  sendPrompt: (text) => ipcRenderer.invoke("send-prompt", text),
  readAnswer: () => ipcRenderer.invoke("read-answer"),
  hideBrowser: () => ipcRenderer.invoke("hide-browser"),
  clearDeepSeek: () => ipcRenderer.invoke("clear-deepseek")
});
