const { app, BrowserWindow, BrowserView, ipcMain, session } = require("electron");
const path = require("path");

const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
app.userAgentFallback = chrome;

let win;
let view;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Тирпроц",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true
    }
  });
  win.loadFile("index.html");
  win.on("resize", () => { if (view) place(lastBounds); });
}

let lastBounds = null;

function place(bounds) {
  if (!view || !bounds) return;
  lastBounds = bounds;
  const area = win.getContentBounds();
  view.setBounds({
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(200, Math.min(Math.round(bounds.width), area.width)),
    height: Math.max(200, Math.min(Math.round(bounds.height), area.height))
  });
}

function ensureView() {
  if (view) return view;
  view = new BrowserView({
    webPreferences: {
      partition: "persist:deepseek",
      contextIsolation: true
    }
  });
  view.webContents.setUserAgent(chrome);
  win.setBrowserView(view);
  view.webContents.loadURL("https://chat.deepseek.com/");
  return view;
}


ipcMain.handle("open-deepseek", async (_e, bounds) => {
  const guest = ensureView();
  guest.webContents.setUserAgent(chrome);
  win.setBrowserView(guest);
  place(bounds);
  const url = guest.webContents.getURL();
  if (!url.includes("deepseek.com")) await guest.webContents.loadURL("https://chat.deepseek.com/");
  else if (guest.webContents.isLoading()) {
    await new Promise((resolve) => guest.webContents.once("did-finish-load", resolve));
  }
  return "ready";
});

ipcMain.handle("hide-browser", () => {
  if (view && win) win.removeBrowserView(view);
  return true;
});

ipcMain.handle("send-prompt", async (_e, text) => {
  const guest = ensureView();
  win.setBrowserView(guest);
  if (lastBounds) place(lastBounds);
  guest.webContents.focus();
  const focused = await guest.webContents.executeJavaScript(`(() => {
    const box = document.querySelector("textarea") || document.querySelector("[contenteditable='true']");
    if (!box) return false;
    box.focus();
    if (box.tagName === "TEXTAREA") box.value = "";
    else box.textContent = "";
    return true;
  })()`);
  if (!focused) return "no-input";
  guest.webContents.insertText(text);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const clicked = await guest.webContents.executeJavaScript(`(() => {
    const box = document.querySelector("textarea") || document.querySelector("[contenteditable='true']");
    const buttons = [...document.querySelectorAll("button")];
    const send = buttons.find((b) => /send|отправ/i.test((b.getAttribute("aria-label") || "") + (b.title || "")));
    if (send && !send.disabled) { send.click(); return "button"; }
    if (box) {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      return "enter";
    }
    return "no-send";
  })()`);
  if (clicked === "no-send") return "no-input";
  guest.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
  guest.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
  return "sent";
});

ipcMain.handle("read-answer", async () => {
  if (!view) return "";
  return view.webContents.executeJavaScript(`(() => {
    const clean = (s) => s.replace(/【[^】]*】/g, "").replace(/\\[\\d+\\]\\([^)]*\\)/g, "");
    const blocks = [...document.querySelectorAll(".ds-markdown, .markdown, [class*='markdown']")].map((n) => n.innerText).filter(Boolean);
    return clean(blocks.length ? blocks[blocks.length - 1] : (document.body ? document.body.innerText : ""));
  })()`);
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
