const { app, BrowserWindow, ipcMain, clipboard, shell } = require("electron");
const path = require("path");

const chatUrl = "https://chat.qwen.ai/";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Тирпроц",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true
    }
  });
  win.loadFile("index.html");
}

ipcMain.handle("open-chat", async (_e, text) => {
  clipboard.writeText(String(text || ""));
  await shell.openExternal(chatUrl);
  return "opened";
});

ipcMain.handle("read-clipboard", () => clipboard.readText());

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
