const { app, BrowserWindow, BrowserView, ipcMain } = require("electron");
const path = require("path");

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
  win.setBrowserView(view);
  view.webContents.loadURL("https://chat.deepseek.com/");
  return view;
}

const inject = `(async (text) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 20; i++) {
    const box = document.querySelector("textarea");
    if (box) {
      box.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      set.call(box, text);
      box.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(300);
      const btn = [...document.querySelectorAll("button")].find((b) => /send|отправ/i.test(b.getAttribute("aria-label") || "") || b.querySelector("svg"));
      const enter = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true });
      box.dispatchEvent(enter);
      if (btn && !btn.disabled) btn.click();
      return "sent";
    }
    await sleep(500);
  }
  return "no-input";
})`;

ipcMain.handle("open-deepseek", async (_e, bounds) => {
  const guest = ensureView();
  place(bounds);
  if (guest.webContents.isLoading()) {
    await new Promise((resolve) => guest.webContents.once("did-finish-load", resolve));
  }
  return "ready";
});

ipcMain.handle("hide-browser", () => {
  if (view && win) win.removeBrowserView(view);
  return true;
});

ipcMain.handle("send-prompt", async (_e, text) => {
  ensureView();
  if (lastBounds) place(lastBounds);
  win.setBrowserView(view);
  return view.webContents.executeJavaScript(inject + `(${JSON.stringify(text)})`);
});

ipcMain.handle("read-answer", async () => {
  if (!view) return "";
  return view.webContents.executeJavaScript(`(() => {
    const nodes = [...document.querySelectorAll("article, .ds-markdown, .markdown, [class*='message']")];
    return nodes.map((n) => n.innerText).filter(Boolean).slice(-4).join("\\n");
  })()`);
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
