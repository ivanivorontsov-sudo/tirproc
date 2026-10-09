const { app, BrowserWindow, BrowserView, ipcMain, clipboard, session } = require("electron");
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

ipcMain.handle("clear-deepseek", async () => {
  if (view && win) win.removeBrowserView(view);
  const ses = session.fromPartition("persist:deepseek");
  await ses.clearStorageData();
  await ses.clearCache();
  if (view) {
    view.webContents.loadURL("https://chat.deepseek.com/");
  }
  return "cleared";
});


ipcMain.handle("send-prompt", async (_e, text) => {
  const guest = ensureView();
  win.setBrowserView(guest);
  if (lastBounds) place(lastBounds);
  clipboard.writeText(text);
  const ready = await guest.webContents.executeJavaScript(`(() => {
    const box = document.querySelector("#chat-input") || document.querySelector("textarea:not([name='search'])");
    if (!box) return false;
    box.focus();
    box.select && box.select();
    return true;
  })()`);
  if (!ready) return "no-input";
  guest.webContents.paste();
  await new Promise((r) => setTimeout(r, 400));
  const clicked = await guest.webContents.executeJavaScript(`(() => {
    const icon = document.querySelector('svg path[d*="M8.3125"]');
    const arrow = icon && (icon.closest('[role="button"]') || icon.closest("button"));
    const named = document.querySelector('[aria-label="Send Message"], [aria-label="Send"]');
    const btn = arrow || named;
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  return clicked ? "sent" : "no-button";
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
