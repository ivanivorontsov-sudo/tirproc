const DB_NAME = "tirproc";
const DB_VER = 1;
const TEMPLATES = {
  classic: { title: "Классика", tiers: ["S","A","B","C","D","F"], colors: ["#c4554a","#d4783a","#d4a017","#6f8f4e","#4f7d8a","#6d645c"] },
  films: { title: "Фильмы", tiers: ["Шедевр","Сильно","Норм","Слабо","Мимо"], colors: ["#8d2f39","#b85c38","#c4a35a","#6e7f8a","#5c534c"] },
  games: { title: "Игры", tiers: ["В зале славы","Ещё зайду","Разок","Полка","Удалить"], colors: ["#9c3b32","#c46b2c","#b8963e","#5f7d6a","#5a514b"] },
  food: { title: "Еда", tiers: ["Каждую неделю","Хорошо","Можно","Нет"], colors: ["#a33b32","#c47a3a","#8a8f55","#6a625c"] }
};

let db;
let boards = [];
let board;
let images = new Map();
let undo = [];
let redo = [];
let dragId = null;

const $ = (id) => document.getElementById(id);

function uid() { return Math.random().toString(36).slice(2, 10); }

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("boards")) d.createObjectStore("boards", { keyPath: "id" });
      if (!d.objectStoreNames.contains("images")) d.createObjectStore("images");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadAll() {
  const tx = db.transaction(["boards", "images"], "readonly");
  const bReq = tx.objectStore("boards").getAll();
  const iReq = tx.objectStore("images").getAll();
  const kReq = tx.objectStore("images").getAllKeys();
  await txDone(tx);
  boards = bReq.result || [];
  images = new Map();
  (kReq.result || []).forEach((k, i) => images.set(k, iReq.result[i]));
  boards.sort((a, b) => b.updated - a.updated);
}

async function saveBoard() {
  board.updated = Date.now();
  const tx = db.transaction("boards", "readwrite");
  tx.objectStore("boards").put(board);
  await txDone(tx);
}

async function saveImage(id, dataUrl) {
  images.set(id, dataUrl);
  const tx = db.transaction("images", "readwrite");
  tx.objectStore("images").put(dataUrl, id);
  await txDone(tx);
}

function blankBoard(template) {
  const t = TEMPLATES[template] || TEMPLATES.classic;
  const tiers = t.tiers.map((label, i) => ({ id: uid(), label, color: t.colors[i] || "#6d645c" }));
  const placements = {};
  tiers.forEach((row) => placements[row.id] = []);
  return {
    id: uid(),
    title: t.title,
    updated: Date.now(),
    tiers,
    placements,
    pool: [],
    items: {}
  };
}

function snapshot() {
  undo.push(JSON.stringify(board));
  if (undo.length > 40) undo.shift();
  redo = [];
}

function restore(raw) {
  board = JSON.parse(raw);
  const i = boards.findIndex((b) => b.id === board.id);
  if (i >= 0) boards[i] = board;
  render();
  saveBoard();
}

function itemEl(item) {
  const el = document.createElement("article");
  el.className = "card";
  el.draggable = true;
  el.dataset.id = item.id;
  if (item.imageId && images.get(item.imageId)) {
    const img = document.createElement("img");
    img.src = images.get(item.imageId);
    img.alt = item.name;
    el.append(img);
  } else {
    const letter = document.createElement("div");
    letter.className = "letter";
    letter.textContent = (item.name || "?").slice(0, 1).toUpperCase();
    el.append(letter);
  }
  const name = document.createElement("b");
  name.textContent = item.name || "без имени";
  const x = document.createElement("button");
  x.className = "x";
  x.textContent = "×";
  x.addEventListener("click", (e) => { e.stopPropagation(); removeItem(item.id); });
  el.append(name, x);
  el.addEventListener("dragstart", () => { dragId = item.id; });
  el.addEventListener("dblclick", () => renameItem(item.id));
  return el;
}

function zone(node, tierId) {
  node.dataset.tier = tierId;
  node.addEventListener("dragover", (e) => { e.preventDefault(); node.classList.add("over"); });
  node.addEventListener("dragleave", () => node.classList.remove("over"));
  node.addEventListener("drop", (e) => {
    e.preventDefault();
    node.classList.remove("over");
    if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, tierId);
    else if (dragId) moveItem(dragId, tierId);
    dragId = null;
  });
}

function render() {
  $("boardTitle").value = board.title;
  const list = $("projectList");
  list.innerHTML = "";
  boards.forEach((b) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = b.title || "без названия";
    if (b.id === board.id) btn.classList.add("active");
    btn.addEventListener("click", () => switchBoard(b.id));
    li.append(btn);
    list.append(li);
  });

  const boardEl = $("board");
  boardEl.innerHTML = "";
  board.tiers.forEach((tier, index) => {
    const row = document.createElement("section");
    row.className = "tier";
    const label = document.createElement("div");
    label.className = "tier-label";
    label.style.background = tier.color;
    label.textContent = tier.label;
    label.title = "Двойной щелчок — переименовать";
    label.addEventListener("dblclick", () => renameTier(tier.id));
    const drop = document.createElement("div");
    drop.className = "drop";
    zone(drop, tier.id);
    (board.placements[tier.id] || []).forEach((id) => {
      if (board.items[id]) drop.append(itemEl(board.items[id]));
    });
    const tools = document.createElement("div");
    tools.className = "tier-tools";
    const up = document.createElement("button");
    up.textContent = "↑";
    up.disabled = index === 0;
    up.addEventListener("click", () => moveTier(index, -1));
    const down = document.createElement("button");
    down.textContent = "↓";
    down.disabled = index === board.tiers.length - 1;
    down.addEventListener("click", () => moveTier(index, 1));
    const color = document.createElement("input");
    color.type = "color";
    color.value = tier.color;
    color.addEventListener("change", () => { snapshot(); tier.color = color.value; persist(); });
    const del = document.createElement("button");
    del.textContent = "×";
    del.addEventListener("click", () => deleteTier(tier.id));
    tools.append(up, down, color, del);
    row.append(label, drop, tools);
    boardEl.append(row);
  });

  const q = $("search").value.trim().toLowerCase();
  const pool = $("pool");
  pool.innerHTML = "";
  zone(pool, "pool");
  const ids = board.pool.filter((id) => {
    const item = board.items[id];
    return item && (!q || (item.name || "").toLowerCase().includes(q) || (item.note || "").toLowerCase().includes(q));
  });
  ids.forEach((id) => pool.append(itemEl(board.items[id])));
  $("poolCount").textContent = board.pool.length ? `(${board.pool.length})` : "";
  renderStats();
}

function renderStats() {
  const box = $("stats");
  box.innerHTML = "";
  const total = Object.keys(board.items).length;
  const line = (name, n) => {
    const d = document.createElement("div");
    d.className = "stat";
    d.innerHTML = `<span>${name}</span><b>${n}</b>`;
    box.append(d);
  };
  line("Всего карточек", total);
  line("В запасе", board.pool.length);
  board.tiers.forEach((t) => line(t.label, (board.placements[t.id] || []).length));
}

function findHome(id) {
  if (board.pool.includes(id)) return "pool";
  return board.tiers.map((t) => t.id).find((tid) => (board.placements[tid] || []).includes(id)) || null;
}

function take(id) {
  const home = findHome(id);
  if (home === "pool") board.pool = board.pool.filter((x) => x !== id);
  else if (home) board.placements[home] = board.placements[home].filter((x) => x !== id);
}

function moveItem(id, tierId) {
  if (!board.items[id] || findHome(id) === tierId) return;
  snapshot();
  take(id);
  if (tierId === "pool") board.pool.unshift(id);
  else board.placements[tierId].push(id);
  persist();
}

function removeItem(id) {
  snapshot();
  take(id);
  delete board.items[id];
  persist();
}

function renameItem(id) {
  const item = board.items[id];
  const name = prompt("Имя карточки", item.name || "");
  if (name == null) return;
  snapshot();
  item.name = name.trim() || item.name;
  persist();
}

function renameTier(id) {
  const tier = board.tiers.find((t) => t.id === id);
  const label = prompt("Имя ряда", tier.label);
  if (!label) return;
  snapshot();
  tier.label = label.trim().slice(0, 16);
  persist();
}

function moveTier(index, dir) {
  const next = index + dir;
  if (next < 0 || next >= board.tiers.length) return;
  snapshot();
  const [row] = board.tiers.splice(index, 1);
  board.tiers.splice(next, 0, row);
  persist();
}

function deleteTier(id) {
  if (board.tiers.length < 2) return alert("Нужен хотя бы один ряд.");
  snapshot();
  (board.placements[id] || []).forEach((item) => board.pool.push(item));
  delete board.placements[id];
  board.tiers = board.tiers.filter((t) => t.id !== id);
  persist();
}

function addText() {
  const name = $("itemName").value.trim();
  if (!name) return;
  snapshot();
  const id = uid();
  board.items[id] = { id, name, note: $("itemNote").value.trim() };
  board.pool.unshift(id);
  $("itemName").value = "";
  $("itemNote").value = "";
  persist();
}

function fileToData(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 240;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addFiles(files, tierId) {
  const list = [...files].filter((f) => f.type.startsWith("image/"));
  if (!list.length) return;
  snapshot();
  for (const file of list) {
    const imageId = uid();
    await saveImage(imageId, await fileToData(file));
    const id = uid();
    board.items[id] = { id, name: file.name.replace(/\.[^.]+$/, "").slice(0, 48), note: "", imageId };
    if (tierId && tierId !== "pool") board.placements[tierId].push(id);
    else board.pool.unshift(id);
  }
  persist();
}

async function persist() {
  await saveBoard();
  const i = boards.findIndex((b) => b.id === board.id);
  if (i >= 0) boards[i] = board;
  boards.sort((a, b) => b.updated - a.updated);
  render();
}

async function switchBoard(id) {
  board = boards.find((b) => b.id === id);
  undo = []; redo = [];
  render();
}

async function newBoard(template) {
  board = blankBoard(template);
  boards.unshift(board);
  await saveBoard();
  undo = []; redo = [];
  render();
}

function exportJson() {
  const payload = { app: "tirproc", version: 1, board, images: {} };
  const used = new Set();
  Object.values(board.items).forEach((item) => { if (item.imageId) used.add(item.imageId); });
  used.forEach((id) => { if (images.get(id)) payload.images[id] = images.get(id); });
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${board.title || "tirproc"}.json`;
  a.click();
}

async function importJson(file) {
  const payload = JSON.parse(await file.text());
  if (!payload.board) return alert("Это не файл Тирпроца.");
  snapshot();
  board = payload.board;
  board.id = uid();
  board.updated = Date.now();
  for (const [id, data] of Object.entries(payload.images || {})) await saveImage(id, data);
  boards.unshift(board);
  await saveBoard();
  render();
}

async function exportPng() {
  const width = 1100;
  const labelW = 140;
  const rowH = 108;
  const height = 70 + board.tiers.length * rowH + 24;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4efe6";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1c1612";
  ctx.font = "28px Georgia";
  ctx.fillText(board.title || "Тирпроц", 24, 42);
  for (let i = 0; i < board.tiers.length; i++) {
    const tier = board.tiers[i];
    const y = 64 + i * rowH;
    ctx.fillStyle = tier.color;
    ctx.fillRect(16, y, labelW, rowH - 8);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px Georgia";
    ctx.fillText(tier.label, 28, y + 48);
    ctx.fillStyle = "#fffaf3";
    ctx.fillRect(16 + labelW, y, width - labelW - 32, rowH - 8);
    let x = 16 + labelW + 10;
    for (const id of board.placements[tier.id] || []) {
      const item = board.items[id];
      if (!item || x > width - 90) break;
      if (item.imageId && images.get(item.imageId)) {
        const img = await loadImg(images.get(item.imageId));
        ctx.drawImage(img, x, y + 8, 72, 72);
      } else {
        ctx.fillStyle = "#efe6da";
        ctx.fillRect(x, y + 8, 72, 72);
        ctx.fillStyle = "#1c1612";
        ctx.font = "16px Georgia";
        ctx.fillText((item.name || "?").slice(0, 8), x + 6, y + 48);
      }
      x += 80;
    }
  }
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `${board.title || "tirproc"}.png`;
  a.click();
}

function loadImg(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = src;
  });
}

function wire() {
  $("boardTitle").addEventListener("change", () => { snapshot(); board.title = $("boardTitle").value.trim() || "Без названия"; persist(); });
  $("newBoard").addEventListener("click", () => newBoard("classic"));
  $("dupBoard").addEventListener("click", async () => {
    const copy = JSON.parse(JSON.stringify(board));
    copy.id = uid();
    copy.title += " — копия";
    board = copy;
    boards.unshift(board);
    await saveBoard();
    render();
  });
  $("delBoard").addEventListener("click", async () => {
    if (!confirm("Удалить этот проект?")) return;
    const tx = db.transaction("boards", "readwrite");
    tx.objectStore("boards").delete(board.id);
    await txDone(tx);
    boards = boards.filter((b) => b.id !== board.id);
    board = boards[0] || blankBoard("classic");
    if (!boards.length) { boards = [board]; await saveBoard(); }
    render();
  });
  $("addTier").addEventListener("click", () => {
    const label = $("tierName").value.trim();
    if (!label) return;
    snapshot();
    const id = uid();
    board.tiers.push({ id, label: label.slice(0, 16), color: $("tierColor").value });
    board.placements[id] = [];
    $("tierName").value = "";
    persist();
  });
  $("addText").addEventListener("click", addText);
  $("itemName").addEventListener("keydown", (e) => { if (e.key === "Enter") addText(); });
  $("addImages").addEventListener("click", () => $("imageFile").click());
  $("imageFile").addEventListener("change", () => addFiles($("imageFile").files, "pool"));
  $("search").addEventListener("input", render);
  $("shuffle").addEventListener("click", () => {
    snapshot();
    board.pool.sort(() => Math.random() - 0.5);
    persist();
  });
  $("clearPool").addEventListener("click", () => {
    if (!confirm("Убрать карточки из запаса?")) return;
    snapshot();
    board.pool.forEach((id) => delete board.items[id]);
    board.pool = [];
    persist();
  });
  $("undoBtn").addEventListener("click", () => { if (!undo.length) return; redo.push(JSON.stringify(board)); restore(undo.pop()); });
  $("redoBtn").addEventListener("click", () => { if (!redo.length) return; undo.push(JSON.stringify(board)); restore(redo.pop()); });
  $("jsonOutBtn").addEventListener("click", exportJson);
  $("jsonInBtn").addEventListener("click", () => $("jsonFile").click());
  $("jsonFile").addEventListener("change", () => importJson($("jsonFile").files[0]));
  $("pngBtn").addEventListener("click", exportPng);
  document.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) addFiles(files, "pool");
  });
  $("templates").innerHTML = "";
  Object.entries(TEMPLATES).forEach(([key, t]) => {
    const btn = document.createElement("button");
    btn.textContent = t.title;
    btn.addEventListener("click", () => newBoard(key));
    $("templates").append(btn);
  });
  document.body.addEventListener("dragover", (e) => e.preventDefault());
  document.body.addEventListener("drop", (e) => {
    if (e.target.closest(".drop, .pool")) return;
    e.preventDefault();
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files, "pool");
  });
}

openDb().then(async (d) => {
  db = d;
  await loadAll();
  if (!boards.length) {
    board = blankBoard("classic");
    boards = [board];
    await saveBoard();
  } else board = boards[0];
  wire();
  wireAi();
  render();
}).catch((err) => {
  document.body.innerHTML = `<p style="padding:24px">Не открылась база: ${err}</p>`;
});


const TIER_COLORS = ["#c4554a","#d4783a","#d4a017","#6f8f4e","#4f7d8a","#6d645c","#7a5b78","#3f6f8a"];

function aiPromptText() {
  const topic = $("aiTopic").value.trim() || "произвольная тема";
  const products = $("aiProducts").value.trim();
  const search = $("aiSearch").checked;
  return [
    "Составь тир-лист.",
    "Тема: " + topic + ".",
    products ? "Обязательно разложи эти пункты, не подменяй их другими: " + products.replace(/\n+/g, ", ") + "." : "Подбери конкретные пункты сам.",
    search ? "Если умеешь искать в интернете, опирайся на свежие рейтинги и обзоры, а не на общую память." : "Опирайся на известные оценки.",
    "Ответ заканчивай одним блоком ```json. Источники, ссылки и сноски пиши только после блока, внутрь JSON не вставляй.",
    "Форма: {\"title\":\"название\",\"tiers\":[{\"label\":\"S\",\"items\":[{\"name\":\"пункт\",\"note\":\"коротко почему\"}]}]}",
    "Ряды от лучшего к худшему, 5 или 6 рядов, в каждом от 3 до 8 пунктов. label короткий. note не длиннее 120 знаков."
  ].join(" ");
}

function extractJson(text) {
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  const source = fenced.length ? fenced[fenced.length - 1] : text
    .replace(/【[^】]*】/g, "")
    .replace(/\[\d+\]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "");
  const found = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "{") continue;
    let depth = 0;
    for (let j = i; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") depth--;
      if (depth === 0) {
        try {
          const data = JSON.parse(source.slice(i, j + 1));
          if (data && Array.isArray(data.tiers) && data.tiers.length) found.push(data);
        } catch {}
        break;
      }
    }
  }
  if (!found.length) throw new Error("В ответе нет готового JSON. Дождись конца ответа, источники после блока не мешают.");
  return found[found.length - 1];
}

function boardFromAi(data) {
  const tiers = (data.tiers || []).slice(0, 8).map((row, i) => ({
    id: uid(),
    label: String(row.label || "Ряд").slice(0, 16),
    color: TIER_COLORS[i % TIER_COLORS.length]
  }));
  if (!tiers.length) throw new Error("В ответе нет рядов");
  const placements = {};
  const items = {};
  tiers.forEach((row, i) => {
    placements[row.id] = [];
    const src = (data.tiers[i].items || []).slice(0, 12);
    src.forEach((it) => {
      const id = uid();
      const name = typeof it === "string" ? it : it.name;
      const note = typeof it === "string" ? "" : it.note;
      items[id] = { id, name: String(name || "пункт").slice(0, 48), note: String(note || "").slice(0, 240) };
      placements[row.id].push(id);
    });
  });
  return {
    id: uid(),
    title: String(data.title || $("aiTopic").value || "Тир-лист").slice(0, 80),
    updated: Date.now(),
    tiers, placements, pool: [], items
  };
}

async function applyAiAnswer(text) {
  const data = extractJson(text);
  board = boardFromAi(data);
  boards.unshift(board);
  undo = []; redo = [];
  await saveBoard();
  render();
  $("aiPanel").hidden = true;
  if (window.tirproc) window.tirproc.hideBrowser();
}

function wireAi() {
  const panel = $("aiPanel");
  const refresh = () => { $("aiPrompt").value = aiPromptText(); };
  $("aiBtn").addEventListener("click", () => { panel.hidden = false; refresh(); });
  $("aiClose").addEventListener("click", () => {
    panel.hidden = true;
    if (window.tirproc) window.tirproc.hideBrowser();
  });
  $("aiTopic").addEventListener("input", refresh);
  $("aiProducts").addEventListener("input", refresh);
  $("aiSearch").addEventListener("change", refresh);
  $("aiCopy").addEventListener("click", async () => {
    refresh();
    try { await navigator.clipboard.writeText($("aiPrompt").value); } catch {}
  });
  $("aiOpen").addEventListener("click", async () => {
    refresh();
    const prompt = $("aiPrompt").value;
    if (window.tirproc) {
      const slot = $("browserSlot");
      slot.textContent = "";
      const rect = slot.getBoundingClientRect();
      await window.tirproc.openDeepSeek({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
      const status = await window.tirproc.sendPrompt(prompt);
      slot.textContent = status === "sent" ? "Запрос ушёл. Дождись конца ответа, потом жми сборку." : "Не нашёл поле #chat-input. Войди в аккаунт и нажми ещё раз.";
      return;
    }
    try { await navigator.clipboard.writeText(prompt); } catch {}
  });
  $("aiBuild").addEventListener("click", async () => {
    let text = "";
    if (window.tirproc) {
      try { text = (await window.tirproc.readAnswer() || "").trim(); } catch (err) { text = ""; }
    }
    if (!text) {
      try { text = (await navigator.clipboard.readText()).trim(); } catch {}
    }
    if (!text) return alert("Ответ DeepSeek ещё не прочитался. Дождись конца ответа и нажми сборку ещё раз.");
    try { await applyAiAnswer(text); }
    catch (err) { alert(err.message); }
  });
  refresh();
}
