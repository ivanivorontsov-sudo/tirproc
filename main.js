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

const inject = `(async (text) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const boxOf = () => document.querySelector("textarea") || document.querySelector("[contenteditable='true']");
  for (let i = 0; i < 30; i++) {
    const box = boxOf();
    if (box) {
      box.focus();
      if (box.tagName === "TEXTAREA") {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        set.call(box, text);
        box.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      } else {
        box.textContent = text;
        box.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }));
      }
      await sleep(400);
      const buttons = [...document.querySelectorAll("button")];
      const send = buttons.find((b) => /send|отправ/i.test((b.getAttribute("aria-label") || "") + (b.title || "")));
      ["keydown", "keyup"].forEach((type) => box.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true })));
      if (send && !send.disabled) send.click();
      return "sent";
    }
    await sleep(500);
  }
  return "no-input";
})`;

ipcMain.handle("open-deepseek", async (_e, bounds) => {
  const guest = ensureView();
  guest.webContents.setUserAgent(chrome);
  place(bounds);
  const url = guest.webContents.getURL();
  if (!url.includes("deepseek.com")) {
    await guest.webContents.loadURL("https://chat.deepseek.com/");
  } else if (guest.webContents.isLoading()) {
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
