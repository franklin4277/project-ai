const STORAGE_KEY = "offline-assistant-v1";
const SUPPORTS_NOTIFICATIONS = typeof Notification !== "undefined";
const SUPPORTS_SERVICE_WORKER = "serviceWorker" in navigator;

const state = loadState();
const ui = bindUi();
let directoryHandle = null;
let deferredInstallPrompt = null;

bootstrap();

function bootstrap() {
  const today = new Date().toISOString().slice(0, 10);
  if (ui.tradeForm?.elements?.date && !ui.tradeForm.elements.date.value) {
    ui.tradeForm.elements.date.value = today;
  }

  setupInstallFlow();
  registerServiceWorker();
  renderAll();
  tickClock();
  refreshSystemStatus();
  maybeAskNotificationPermission();

  setInterval(() => {
    tickClock();
    refreshProactiveTip();
    checkTaskReminders();
  }, 30_000);

  setInterval(refreshSystemStatus, 60_000);

  ui.taskForm.addEventListener("submit", onTaskSubmit);
  ui.habitForm.addEventListener("submit", onHabitSubmit);
  ui.noteForm.addEventListener("submit", onNoteSubmit);
  ui.tradeForm.addEventListener("submit", onTradeSubmit);
  ui.priceForm.addEventListener("submit", onPriceSubmit);
  ui.prefsForm.addEventListener("submit", onPrefsSubmit);
  ui.noteSearch.addEventListener("input", renderNotes);
  ui.runCommand.addEventListener("click", runCommand);
  ui.commandInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runCommand();
    }
  });

  ui.pickDirectory.addEventListener("click", pickDirectory);
  ui.fileQuery.addEventListener("input", renderFiles);
}

function bindUi() {
  return {
    currentTime: document.querySelector("#current-time"),
    proactiveTip: document.querySelector("#proactive-tip"),
    taskCount: document.querySelector("#task-count"),
    taskForm: document.querySelector("#task-form"),
    taskList: document.querySelector("#task-list"),
    timeBlocks: document.querySelector("#time-blocks"),
    habitCount: document.querySelector("#habit-count"),
    habitForm: document.querySelector("#habit-form"),
    habitList: document.querySelector("#habit-list"),
    noteForm: document.querySelector("#note-form"),
    noteSearch: document.querySelector("#note-search"),
    noteList: document.querySelector("#note-list"),
    tradeForm: document.querySelector("#trade-form"),
    tradeStats: document.querySelector("#trade-stats"),
    tradeList: document.querySelector("#trade-list"),
    priceForm: document.querySelector("#price-form"),
    priceSummary: document.querySelector("#price-summary"),
    systemStatus: document.querySelector("#system-status"),
    prefsForm: document.querySelector("#prefs-form"),
    prefsSummary: document.querySelector("#prefs-summary"),
    commandInput: document.querySelector("#command-input"),
    runCommand: document.querySelector("#run-command"),
    commandOutput: document.querySelector("#command-output"),
    installApp: document.querySelector("#install-app"),
    appInstallStatus: document.querySelector("#app-install-status"),
    pickDirectory: document.querySelector("#pick-directory"),
    fileQuery: document.querySelector("#file-query"),
    fileList: document.querySelector("#file-list"),
    taskTemplate: document.querySelector("#task-item-template"),
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        tasks: [],
        habits: [],
        notes: [],
        trades: [],
        prices: [],
        files: [],
        prefs: {},
      };
    }

    const parsed = JSON.parse(raw);
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      habits: Array.isArray(parsed.habits) ? parsed.habits : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
      prices: Array.isArray(parsed.prices) ? parsed.prices : [],
      files: Array.isArray(parsed.files) ? parsed.files : [],
      prefs: typeof parsed.prefs === "object" && parsed.prefs ? parsed.prefs : {},
    };
  } catch {
    return {
      tasks: [],
      habits: [],
      notes: [],
      trades: [],
      prices: [],
      files: [],
      prefs: {},
    };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function onTaskSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);

  const title = String(form.get("title") || "").trim();
  const due = String(form.get("due") || "").trim();
  const priority = String(form.get("priority") || "medium").trim();

  if (!title) {
    return;
  }

  state.tasks.unshift({
    id: crypto.randomUUID(),
    title,
    due: due || null,
    priority,
    done: false,
    reminded: false,
    createdAt: Date.now(),
  });

  saveState();
  event.currentTarget.reset();
  renderTasks();
  renderTimeBlocks();
  refreshProactiveTip();
}

function onHabitSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const habit = String(form.get("habit") || "").trim();

  if (!habit) {
    return;
  }

  state.habits.unshift({
    id: crypto.randomUUID(),
    name: habit,
    streak: 0,
    completions: 0,
    lastDoneDate: null,
  });

  saveState();
  event.currentTarget.reset();
  renderHabits();
}

function onNoteSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const title = String(form.get("title") || "").trim();
  const content = String(form.get("content") || "").trim();
  const tags = String(form.get("tags") || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (!title || !content) {
    return;
  }

  state.notes.unshift({
    id: crypto.randomUUID(),
    title,
    content,
    tags,
    updatedAt: Date.now(),
  });

  saveState();
  event.currentTarget.reset();
  renderNotes();
}

function onTradeSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const symbol = String(form.get("symbol") || "").trim().toUpperCase();
  const direction = String(form.get("direction") || "long").trim();
  const size = Number(form.get("size"));
  const entry = Number(form.get("entry"));
  const exit = Number(form.get("exit"));
  const date = String(form.get("date") || "").trim();
  const notes = String(form.get("notes") || "").trim();

  if (!symbol || !date || Number.isNaN(size) || Number.isNaN(entry) || Number.isNaN(exit)) {
    return;
  }

  const pnlPerUnit = direction === "long" ? exit - entry : entry - exit;
  const pnl = pnlPerUnit * size;

  state.trades.unshift({
    id: crypto.randomUUID(),
    symbol,
    direction,
    size,
    entry,
    exit,
    date,
    pnl,
    notes,
  });

  saveState();
  event.currentTarget.reset();
  renderTrades();
}

function onPriceSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const price = Number(form.get("price"));

  if (Number.isNaN(price)) {
    return;
  }

  state.prices.push({ price, ts: Date.now() });
  if (state.prices.length > 200) {
    state.prices.shift();
  }

  saveState();
  event.currentTarget.reset();
  renderPriceSummary();
}

function onPrefsSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.prefs = {
    name: String(form.get("name") || "").trim(),
    studyTime: String(form.get("studyTime") || "").trim(),
    tradingSession: String(form.get("tradingSession") || "").trim(),
    wakeTime: String(form.get("wakeTime") || "").trim(),
  };
  saveState();
  renderPrefs();
  refreshProactiveTip();
}

function renderAll() {
  renderTasks();
  renderTimeBlocks();
  renderHabits();
  renderNotes();
  renderTrades();
  renderPriceSummary();
  renderPrefs();
  renderFiles();
  refreshProactiveTip();
}

function renderTasks() {
  const openTasks = state.tasks.filter((task) => !task.done).length;
  ui.taskCount.textContent = `${openTasks} open`;
  ui.taskList.innerHTML = "";

  if (state.tasks.length === 0) {
    ui.taskList.innerHTML = "<li>No tasks yet.</li>";
    return;
  }

  state.tasks
    .slice()
    .sort((a, b) => Number(a.done) - Number(b.done))
    .forEach((task) => {
      const node = ui.taskTemplate.content.firstElementChild.cloneNode(true);
      const checkbox = node.querySelector("input[type='checkbox']");
      const titleEl = node.querySelector(".item-title");
      const metaEl = node.querySelector(".item-meta");
      const delBtn = node.querySelector("button");

      checkbox.checked = task.done;
      titleEl.textContent = task.title;
      if (task.done) {
        titleEl.classList.add("done");
      }

      const dueText = task.due ? new Date(task.due).toLocaleString() : "No due time";
      metaEl.textContent = `Due: ${dueText} · Priority: ${task.priority}`;

      checkbox.addEventListener("change", () => {
        task.done = checkbox.checked;
        if (task.done) {
          task.reminded = true;
        }
        saveState();
        renderTasks();
        renderTimeBlocks();
        refreshProactiveTip();
      });

      delBtn.addEventListener("click", () => {
        state.tasks = state.tasks.filter((item) => item.id !== task.id);
        saveState();
        renderTasks();
        renderTimeBlocks();
        refreshProactiveTip();
      });

      ui.taskList.appendChild(node);
    });
}

function renderTimeBlocks() {
  ui.timeBlocks.innerHTML = "";
  const pending = state.tasks
    .filter((task) => !task.done)
    .slice()
    .sort((a, b) => {
      const ta = a.due ? new Date(a.due).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b.due ? new Date(b.due).getTime() : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    })
    .slice(0, 5);

  if (pending.length === 0) {
    ui.timeBlocks.innerHTML = "<li>Add tasks to generate a schedule.</li>";
    return;
  }

  const now = new Date();
  now.setMinutes(0, 0, 0);

  pending.forEach((task, index) => {
    const slotStart = new Date(now.getTime() + (index + 1) * 45 * 60 * 1000);
    const slotEnd = new Date(slotStart.getTime() + 35 * 60 * 1000);
    const item = document.createElement("li");
    item.textContent = `${slotStart.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} - ${slotEnd.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: ${task.title}`;
    ui.timeBlocks.appendChild(item);
  });
}

function renderHabits() {
  ui.habitCount.textContent = `${state.habits.length} active`;
  ui.habitList.innerHTML = "";

  if (state.habits.length === 0) {
    ui.habitList.innerHTML = "<li>No habits yet.</li>";
    return;
  }

  state.habits.forEach((habit) => {
    const li = document.createElement("li");
    const row = document.createElement("div");
    row.className = "item-row";

    const name = document.createElement("strong");
    name.textContent = habit.name;

    const done = document.createElement("button");
    done.type = "button";
    done.className = "small";
    done.textContent = "Mark Done";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger small";
    remove.textContent = "Delete";

    const footer = document.createElement("p");
    footer.className = "item-meta";
    footer.textContent = `Streak: ${habit.streak} days · Total completions: ${habit.completions}`;

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "0.3rem";

    actions.append(done, remove);
    row.append(name, actions);

    done.addEventListener("click", () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      if (habit.lastDoneDate === today) {
        return;
      }

      habit.streak = habit.lastDoneDate === yesterday ? habit.streak + 1 : 1;
      habit.completions += 1;
      habit.lastDoneDate = today;
      saveState();
      renderHabits();
    });

    remove.addEventListener("click", () => {
      state.habits = state.habits.filter((item) => item.id !== habit.id);
      saveState();
      renderHabits();
    });

    li.append(row, footer);
    ui.habitList.appendChild(li);
  });
}

function renderNotes() {
  ui.noteList.innerHTML = "";
  const query = ui.noteSearch.value.trim().toLowerCase();

  const notes = state.notes.filter((note) => {
    if (!query) return true;
    return `${note.title} ${note.content} ${(note.tags || []).join(" ")}`.toLowerCase().includes(query);
  });

  if (notes.length === 0) {
    ui.noteList.innerHTML = "<li>No matching notes.</li>";
    return;
  }

  notes.forEach((note) => {
    const li = document.createElement("li");
    const header = document.createElement("div");
    header.className = "item-row";

    const title = document.createElement("strong");
    title.textContent = note.title;

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "0.3rem";

    const summarize = document.createElement("button");
    summarize.type = "button";
    summarize.className = "small";
    summarize.textContent = "Summarize";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger small";
    remove.textContent = "Delete";

    actions.append(summarize, remove);
    header.append(title, actions);

    const content = document.createElement("p");
    content.className = "item-meta";
    content.textContent = note.content;

    const tags = document.createElement("p");
    tags.className = "item-meta";
    tags.textContent = note.tags && note.tags.length ? `Tags: ${note.tags.join(", ")}` : "Tags: none";

    summarize.addEventListener("click", () => {
      const summary = summarizeText(note.content);
      ui.commandOutput.textContent = `Summary (${note.title}): ${summary}`;
    });

    remove.addEventListener("click", () => {
      state.notes = state.notes.filter((item) => item.id !== note.id);
      saveState();
      renderNotes();
    });

    li.append(header, content, tags);
    ui.noteList.appendChild(li);
  });
}

function renderTrades() {
  ui.tradeList.innerHTML = "";

  if (state.trades.length === 0) {
    ui.tradeStats.textContent = "No trades logged yet.";
    ui.tradeList.innerHTML = "<li>Add your first trade journal entry.</li>";
    return;
  }

  let wins = 0;
  let totalPnl = 0;

  state.trades.forEach((trade) => {
    totalPnl += trade.pnl;
    if (trade.pnl > 0) {
      wins += 1;
    }

    const li = document.createElement("li");
    const pnlSign = trade.pnl >= 0 ? "+" : "";
    li.textContent = `${trade.date} · ${trade.symbol} ${trade.direction} · ${pnlSign}${trade.pnl.toFixed(2)} · entry ${trade.entry} exit ${trade.exit}`;
    ui.tradeList.appendChild(li);
  });

  const winRate = (wins / state.trades.length) * 100;
  ui.tradeStats.textContent = `Trades: ${state.trades.length} · Win rate: ${winRate.toFixed(1)}% · Net PnL: ${totalPnl.toFixed(2)}`;
}

function renderPriceSummary() {
  const data = state.prices.map((item) => item.price);

  if (data.length < 2) {
    ui.priceSummary.textContent = "Add at least two prices to compute movement and average.";
    return;
  }

  const latest = data[data.length - 1];
  const first = data[0];
  const change = latest - first;
  const avg = data.reduce((sum, value) => sum + value, 0) / data.length;
  const sma5 = simpleMovingAverage(data, 5);

  ui.priceSummary.textContent = `Points: ${data.length} · Change: ${change.toFixed(4)} · Avg: ${avg.toFixed(4)} · SMA(5): ${sma5.toFixed(4)}`;
}

function renderPrefs() {
  const { name = "", studyTime = "", tradingSession = "", wakeTime = "" } = state.prefs;
  const summary = [
    name ? `Name: ${name}` : null,
    studyTime ? `Study: ${studyTime}` : null,
    tradingSession ? `Trading session: ${tradingSession}` : null,
    wakeTime ? `Wake: ${wakeTime}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  ui.prefsSummary.textContent = summary || "No preferences saved yet.";

  const controls = ui.prefsForm.elements;
  controls.name.value = name;
  controls.studyTime.value = studyTime;
  controls.tradingSession.value = tradingSession;
  controls.wakeTime.value = wakeTime;
}

function tickClock() {
  const now = new Date();
  ui.currentTime.textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function refreshProactiveTip() {
  const now = new Date();
  const hour = now.getHours();
  const name = state.prefs.name ? `${state.prefs.name}, ` : "";
  let tip = "Plan one important task for this block.";

  if (hour < 10) {
    tip = `${name}start with a high-priority task and one habit check.`;
  } else if (hour < 14) {
    tip = `${name}batch deep work now and defer short tasks later.`;
  } else if (hour < 19) {
    tip = `${name}review your notes and prep your next session.`;
  } else {
    tip = `${name}close open loops: complete quick tasks and journal progress.`;
  }

  if (state.prefs.studyTime) {
    tip += ` Study target: ${state.prefs.studyTime}.`;
  }

  ui.proactiveTip.textContent = tip;
}

function checkTaskReminders() {
  const now = Date.now();
  state.tasks.forEach((task) => {
    if (task.done || task.reminded || !task.due) {
      return;
    }

    const dueTime = new Date(task.due).getTime();
    if (Number.isNaN(dueTime)) {
      return;
    }

    if (dueTime <= now) {
      task.reminded = true;
      const message = `Reminder: ${task.title}`;
      ui.commandOutput.textContent = message;
      sendNotification(message);
      saveState();
      renderTasks();
    }
  });
}

function maybeAskNotificationPermission() {
  if (!SUPPORTS_NOTIFICATIONS) {
    return;
  }

  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {
      // Silent fallback for unsupported environments.
    });
  }
}

function sendNotification(message) {
  if (!SUPPORTS_NOTIFICATIONS || Notification.permission !== "granted") {
    return;
  }

  new Notification("Offline Assistant", {
    body: message,
    silent: false,
  });
}

function setupInstallFlow() {
  if (!ui.installApp || !ui.appInstallStatus) {
    return;
  }

  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true;

  if (standalone) {
    ui.installApp.hidden = true;
    setInstallStatus("Running as installed app.");
  } else {
    setInstallStatus("Install from your browser menu if prompted.");
  }

  ui.installApp.addEventListener("click", promptInstall);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    ui.installApp.hidden = false;
    ui.installApp.disabled = false;
    setInstallStatus("Install available. Tap Install App.");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    ui.installApp.hidden = true;
    setInstallStatus("App installed. Open it from your launcher/home screen.");
  });
}

function setInstallStatus(text) {
  if (!ui.appInstallStatus) {
    return;
  }
  ui.appInstallStatus.textContent = text;
}

async function promptInstall() {
  if (!deferredInstallPrompt) {
    setInstallStatus("Install prompt not available. Use your browser's install option.");
    return;
  }

  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;

  if (choice.outcome === "accepted") {
    setInstallStatus("Installing app...");
  } else {
    setInstallStatus("Install canceled.");
  }

  deferredInstallPrompt = null;
  ui.installApp.hidden = true;
}

function registerServiceWorker() {
  if (!SUPPORTS_SERVICE_WORKER) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      setInstallStatus("Offline cache unavailable in this browser/session.");
    });
  });
}

function summarizeText(text) {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  if (sentences.length <= 2) {
    return text;
  }

  const stopWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "for",
    "is",
    "are",
    "this",
    "that",
    "it",
    "with",
  ]);

  const freq = new Map();
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word && !stopWords.has(word))
    .forEach((word) => {
      freq.set(word, (freq.get(word) || 0) + 1);
    });

  const scored = sentences.map((sentence, idx) => {
    const score = sentence
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .reduce((sum, word) => sum + (freq.get(word) || 0), 0);

    return { idx, sentence, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.idx - b.idx)
    .map((item) => item.sentence)
    .join(" ");
}

function simpleMovingAverage(values, period) {
  const window = values.slice(Math.max(0, values.length - period));
  return window.reduce((sum, value) => sum + value, 0) / window.length;
}

function runCommand() {
  const raw = ui.commandInput.value.trim();
  if (!raw) {
    return;
  }

  const value = raw.toLowerCase();

  if (value.startsWith("add task ")) {
    const taskText = raw.slice(9).trim();
    let title = taskText;
    let due = null;

    const match = taskText.match(/(.+)\s+at\s+(\d{1,2}:\d{2})$/i);
    if (match) {
      title = match[1].trim();
      due = buildTodayDateTime(match[2]);
    }

    state.tasks.unshift({
      id: crypto.randomUUID(),
      title,
      due,
      priority: "medium",
      done: false,
      reminded: false,
      createdAt: Date.now(),
    });

    saveState();
    renderTasks();
    renderTimeBlocks();
    refreshProactiveTip();
    ui.commandOutput.textContent = `Task added: ${title}`;
  } else if (value.startsWith("add habit ")) {
    const habit = raw.slice(10).trim();
    if (habit) {
      state.habits.unshift({
        id: crypto.randomUUID(),
        name: habit,
        streak: 0,
        completions: 0,
        lastDoneDate: null,
      });
      saveState();
      renderHabits();
      ui.commandOutput.textContent = `Habit added: ${habit}`;
    }
  } else if (value.startsWith("note ")) {
    const body = raw.slice(5).trim();
    const [title, content] = body.split("::").map((part) => part && part.trim());

    if (title && content) {
      state.notes.unshift({
        id: crypto.randomUUID(),
        title,
        content,
        tags: [],
        updatedAt: Date.now(),
      });
      saveState();
      renderNotes();
      ui.commandOutput.textContent = `Note saved: ${title}`;
    } else {
      ui.commandOutput.textContent = "Use note format: note Title :: Content";
    }
  } else if (value === "help") {
    ui.commandOutput.textContent = "Commands: add task <text> [at HH:MM], add habit <name>, note <title> :: <content>, help";
  } else {
    ui.commandOutput.textContent = "Command not recognized. Type help for examples.";
  }

  ui.commandInput.value = "";
}

function buildTodayDateTime(hhmm) {
  const now = new Date();
  const [hours, minutes] = hhmm.split(":").map(Number);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  const local = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    0,
    0
  );

  // If time already passed today, schedule it for tomorrow.
  if (local.getTime() < Date.now()) {
    local.setDate(local.getDate() + 1);
  }

  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  const hh = String(local.getHours()).padStart(2, "0");
  const mm = String(local.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hh}:${mm}`;
}

async function refreshSystemStatus() {
  const lines = [];

  lines.push(`Platform: ${navigator.platform || "Unknown"}`);
  lines.push(`CPU threads: ${navigator.hardwareConcurrency || "Unknown"}`);
  lines.push(`Device memory: ${navigator.deviceMemory ? `${navigator.deviceMemory} GB` : "Unknown"}`);
  lines.push(`Online flag: ${navigator.onLine ? "Online" : "Offline"} (app works offline)`);

  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      const usedMb = estimate.usage ? (estimate.usage / 1_048_576).toFixed(1) : "0";
      const quotaMb = estimate.quota ? (estimate.quota / 1_048_576).toFixed(1) : "Unknown";
      lines.push(`Storage: ${usedMb} MB used / ${quotaMb} MB quota`);
    } catch {
      lines.push("Storage: unavailable");
    }
  }

  if (navigator.getBattery) {
    try {
      const battery = await navigator.getBattery();
      lines.push(`Battery: ${(battery.level * 100).toFixed(0)}% ${battery.charging ? "(charging)" : ""}`);
    } catch {
      lines.push("Battery: unavailable");
    }
  }

  ui.systemStatus.innerHTML = "";
  lines.forEach((line) => {
    const li = document.createElement("li");
    li.textContent = line;
    ui.systemStatus.appendChild(li);
  });
}

async function pickDirectory() {
  if (!window.showDirectoryPicker) {
    ui.commandOutput.textContent = "This browser does not support directory access.";
    return;
  }

  try {
    directoryHandle = await window.showDirectoryPicker();
    state.files = await walkFiles(directoryHandle);
    saveState();
    renderFiles();
    ui.commandOutput.textContent = `Loaded ${state.files.length} files from selected folder.`;
  } catch {
    ui.commandOutput.textContent = "Directory access was canceled or unavailable.";
  }
}

async function walkFiles(handle, prefix = "", depth = 0) {
  if (depth > 4) {
    return [];
  }

  const out = [];
  for await (const [name, childHandle] of handle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (childHandle.kind === "file") {
      out.push(path);
    } else if (childHandle.kind === "directory") {
      const nested = await walkFiles(childHandle, path, depth + 1);
      out.push(...nested);
    }
  }

  return out;
}

function renderFiles() {
  ui.fileList.innerHTML = "";
  const query = ui.fileQuery.value.trim().toLowerCase();

  const filtered = state.files
    .filter((path) => path.toLowerCase().includes(query))
    .slice(0, 50);

  if (filtered.length === 0) {
    ui.fileList.innerHTML = "<li>No files to display.</li>";
    return;
  }

  filtered.forEach((path) => {
    const li = document.createElement("li");
    li.textContent = path;
    ui.fileList.appendChild(li);
  });
}
