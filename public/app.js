// --- FIREBASE CLOUD CONFIGURATION ---
const firebaseConfig = window.HYDROHELP_FIREBASE_CONFIG || {
  apiKey: "AIzaSyA1-0M4xllmgGYCuRHY8vlTPGfwj9N4uwk",
  authDomain: "hydrowise-farm.firebaseapp.com",
  databaseURL: "https://hydrowise-farm-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "hydrowise-farm",
  storageBucket: "hydrowise-farm.firebasestorage.app",
  messagingSenderId: "1049020345800",
  appId: "1:1049020345800:web:de140b9861cd64a779a4fd"
};

let db = null;
let firebaseAuthReady = false;
let firebaseListenersStarted = false;
let uiInitialized = false;

if (typeof firebase !== "undefined") {
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    db = firebase.database();

    // Authenticate with Firebase before attaching RTDB listeners (rules require auth != null)
    if (firebase.auth) {
      const auth = firebase.auth();
      auth.onAuthStateChanged((user) => {
        if (user) {
          firebaseAuthReady = true;
          const statusEl = document.getElementById("firebase-status");
          if (statusEl) statusEl.textContent = "Authenticated & Connected";
          if (uiInitialized && !firebaseListenersStarted) {
            try { initFirebaseListeners(); } catch (e) { console.error("Error initializing Firebase:", e); }
          }
        }
      });
      auth.signInWithEmailAndPassword("robot-controller@example.com", "123456789")
        .then(() => {
          console.log("[Firebase] Authenticated with operator credentials.");
        })
        .catch((err) => {
          console.warn("[Firebase] Operator sign-in failed:", err.message);
          const statusEl = document.getElementById("firebase-status");
          if (statusEl) statusEl.textContent = "Auth failed: " + err.message;
        });
    }
  } catch (err) {
    console.error("Firebase initialization failed:", err);
  }
}

function ref(database, path) {
  if (!database) return null;
  return database.ref(path);
}

function onValue(dbRef, callback) {
  if (!dbRef) return;
  dbRef.on("value", callback);
}

function set(dbRef, value) {
  if (!dbRef) return Promise.resolve();
  return dbRef.set(value);
}

function update(dbRef, values) {
  if (!dbRef) return Promise.resolve();
  return dbRef.update(values);
}

function push(dbRef, value) {
  if (!dbRef) return Promise.resolve();
  return dbRef.push(value);
}

// --- GLOBAL UI STATE ---
const state = {
  activeView: "overview",
  recording: false,
  recordedSteps: [],
  selectedSensor: "start",
  modes: { manual: true },
  pumpRunning: false,
  taskRunning: false,
  arm: { rail: 0, base: 0, elbow: 0, lift: 0, yaw: 0, gripper: 0 },
  lastRailCommand: "None",
  trays: [
    { id: "unit1_left", unit: "Unit 1", side: "Left bay", name: "Unit 1 - Left bay", crop: "Pak choi", health: "Healthy", moisture: 75, soilStatus: "Optimal", target: "55-70%", valve: "Closed", lastCycle: "--:--", growthDays: 14, harvestReady: false, gpio: "D1", soilPin: "D7", isHomeStation: false },
    { id: "unit1_right", unit: "Unit 1", side: "Right bay", name: "Unit 1 - Home Station", crop: "Home Station & Tool Dock", health: "Online", moisture: null, soilStatus: "Dock", target: "N/A", valve: "N/A", lastCycle: "N/A", growthDays: 0, harvestReady: false, gpio: null, soilPin: null, isHomeStation: true },
    { id: "unit2_left", unit: "Unit 2", side: "Left bay", name: "Unit 2 - Left bay", crop: "Lettuce", health: "Healthy", moisture: 75, soilStatus: "Optimal", target: "55-70%", valve: "Closed", lastCycle: "--:--", growthDays: 21, harvestReady: false, gpio: "D2", soilPin: "D3", isHomeStation: false },
    { id: "unit2_right", unit: "Unit 2", side: "Right bay", name: "Unit 2 - Right bay", crop: "Unassigned", health: "N/A", moisture: 75, soilStatus: "Optimal", target: "55-70%", valve: "Closed", lastCycle: "--:--", growthDays: 0, harvestReady: false, gpio: "D5", soilPin: "D4", isHomeStation: false }
  ],
  routines: [], // Cleared placeholders so you can record fresh hardware-accurate routines
  tasks: [],
  events: []
};

// --- KINEMATIC AXES MAPPING ---
const axes = [
  { key: "rail", label: "Rail travel", unit: "steps", step: 8000, controller: "Arm ESP", command: "R" },
  { key: "base", label: "Base rotation", unit: "steps", step: 8000, controller: "Arduino Uno", command: "B" },
  { key: "elbow", label: "Elbow", unit: "steps", step: 6000, controller: "Arduino Uno", command: "E" },
  { key: "lift", label: "Z lift", unit: "steps", step: 15000, controller: "Arduino Uno", command: "Z" },
  { key: "yaw", label: "Claw yaw", unit: "steps", step: 2000, controller: "Arduino Uno", command: "C" }
];

const viewTitles = { overview: "System overview", manual: "Manual control", routines: "Motion routines", trays: "Grow trays", activity: "Activity log" };

// --- UTILITY FUNCTIONS ---
function icon(name) { return `<i data-lucide="${name}" aria-hidden="true"></i>`; }
function refreshIcons() { if (window.lucide) window.lucide.createIcons({ attrs: { width: 16, height: 16 } }); }
function formatNumber(value) { return Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
function now() { return new Date().toLocaleTimeString("en-GB", { hour12: false }); }

function showToast(message, tone = "success") {
  const region = document.getElementById("toast-region");
  const item = document.createElement("div");
  item.className = `toast ${tone === "warning" ? "warning" : ""}`;
  item.innerHTML = `${icon(tone === "warning" ? "triangle-alert" : "circle-check")}<span>${message}</span>`;
  region.append(item);
  refreshIcons();
  setTimeout(() => item.remove(), 4200);
}

function addEvent(source, message, status = "Completed") {
  state.events.unshift({ time: now(), source, message, status });
  state.events = state.events.slice(0, 30);
  renderEvents();
}

function setView(view) {
  state.activeView = view;
  document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.id === `${view}-view`));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.getElementById("page-title").textContent = viewTitles[view];
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// --- RELAY & PUMP UI STATUS HELPERS ---
function updatePumpUI(isRunning) {
  state.pumpRunning = isRunning;
  const pumpStateEl = document.getElementById("pump-state");
  const pumpDetailEl = document.getElementById("pump-detail");
  const togglePumpLabel = document.getElementById("toggle-pump-label");
  const trayPumpLabel = document.getElementById("tray-pump-label");
  const manualPumpStatus = document.getElementById("manual-pump-status");
  const manualPumpBtnText = document.getElementById("manual-pump-btn-text");

  if (pumpStateEl) {
    pumpStateEl.textContent = isRunning ? "Running" : "Idle";
    pumpStateEl.style.color = isRunning ? "var(--primary, #156a53)" : "";
  }
  if (pumpDetailEl) {
    pumpDetailEl.textContent = isRunning ? "Main pump active (Pin D6)" : "Main Pump (Pin D6) · Relays ready";
  }
  if (togglePumpLabel) {
    togglePumpLabel.textContent = isRunning ? "Stop Pump" : "Start Pump";
  }
  if (trayPumpLabel) {
    trayPumpLabel.textContent = isRunning ? "Stop Main Pump" : "Start Main Pump";
  }
  if (manualPumpStatus) {
    manualPumpStatus.textContent = isRunning ? "RUNNING (ON)" : "IDLE (OFF)";
    manualPumpStatus.style.color = isRunning ? "var(--primary, #156a53)" : "";
  }
  if (manualPumpBtnText) {
    manualPumpBtnText.textContent = isRunning ? "Stop Pump" : "Start Pump";
  }
}

function updateRelayStatusUI() {
  state.trays.forEach(tray => {
    if (tray.isHomeStation) return;
    const el = document.getElementById(`manual-valve-${tray.id}-status`);
    if (el) {
      const isOpen = tray.valve === "Open";
      el.textContent = isOpen ? "OPEN (ON)" : "CLOSED (OFF)";
      el.style.color = isOpen ? "var(--primary, #156a53)" : "";
    }
  });
}

// --- FIREBASE LIVE SYNC LISTENERS ---
function initFirebaseListeners() {
  if (firebaseListenersStarted) return;
  if (!db) {
    const statusEl = document.getElementById("firebase-status");
    if (statusEl) statusEl.textContent = "Offline / SDK not loaded";
    return;
  }
  if (firebase.auth && !firebaseAuthReady) {
    const statusEl = document.getElementById("firebase-status");
    if (statusEl) statusEl.textContent = "Authenticating...";
    return;
  }
  firebaseListenersStarted = true;

  onValue(ref(db, '.info/connected'), (snapshot) => {
    const connected = snapshot.val() === true;
    const statusEl = document.getElementById("firebase-status");
    if (statusEl) {
      statusEl.textContent = connected ? "Realtime connected" : "Offline / reconnecting";
    }
  });

  onValue(ref(db, 'trays'), (snapshot) => {
    const data = snapshot.val();
    if (!data) return;
    state.trays.forEach(tray => {
      if (tray.isHomeStation) {
        // Keep Unit 1 Right strictly as Home Station & Tool Dock
        tray.crop = "Home Station & Tool Dock";
        tray.moisture = null;
        tray.valve = "N/A";
        return;
      }
      if (data[tray.id]) {
        tray.crop = data[tray.id].crop || "Unassigned";
        if (data[tray.id].moisture !== undefined && data[tray.id].moisture !== null) {
          tray.moisture = Number(data[tray.id].moisture);
        }
        if (data[tray.id].soil_status) {
          tray.soilStatus = data[tray.id].soil_status;
        }
        tray.health = data[tray.id].health || "N/A";
        tray.visionState = data[tray.id].vision_state || "";
        tray.harvestReady = Boolean(data[tray.id].harvest_ready);
        if (data[tray.id].valve_state) {
          tray.valve = data[tray.id].valve_state === "OPEN" ? "Open" : "Closed";
        }
      }
    });
    renderTrays();
    updateTrayMap();
    updateRelayStatusUI();
  });

  onValue(ref(db, 'farm_config'), (snapshot) => {
    const config = snapshot.val();
    if (!config) return;
    if (config.ambient_humidity !== undefined || config.ambient_temperature !== undefined) {
      const climateEl = document.getElementById("ambient-climate-val");
      if (climateEl) {
        climateEl.textContent = `${Number(config.ambient_temperature || 0).toFixed(1)}°C · ${Number(config.ambient_humidity || 0).toFixed(0)}% Hum`;
      }
    }
    if (config.current_rail_gate) {
      const gateMap = { "HOME": "start", "CENTER": "middle", "END": "end" };
      const sensorKey = gateMap[config.current_rail_gate] || "start";
      if (state.selectedSensor !== sensorKey) selectSensor(sensorKey, true);
    }
    if (config.system_mode) {
      const isAuto = config.system_mode === "AUTONOMOUS";
      document.querySelectorAll(".segmented button").forEach((btn) => {
        btn.classList.toggle("selected", (btn.dataset.mode === "autonomous") === isAuto);
      });
      const statusMsg = document.getElementById("system-status-msg");
      if (statusMsg) {
        statusMsg.textContent = isAuto ? "Autonomous Patrol Active." : "Manual Control Mode.";
      }
    }
    if (config.pump_state) {
      const isRunning = config.pump_state === "RUNNING";
      updatePumpUI(isRunning);
    }
    if (config.relay_polarity) {
      const label = config.relay_polarity.replace("_", " ");
      const badge1 = document.getElementById("relay-polarity-badge");
      if (badge1) badge1.textContent = label;
      const badge2 = document.getElementById("manual-relay-polarity-badge");
      if (badge2) badge2.textContent = label;
    }
  });

  onValue(ref(db, 'arm_config'), (snapshot) => {
    const cfg = snapshot.val();
    if (!cfg) return;
    const armStateEl = document.getElementById("arm-state");
    const armDetailEl = document.getElementById("arm-link-detail");
    const trackBadgeEl = document.getElementById("husky-track-badge");
    const huskyIpInput = document.getElementById("husky-ip-input");
    const railPosEl = document.getElementById("rail-position");

    if (armStateEl) {
      armStateEl.textContent = cfg.arm_online ? (cfg.system_mode === "ESTOPPED" ? "Stopped" : "Online") : "Offline";
    }
    if (armDetailEl) {
      const rssiTxt = cfg.rssi !== undefined ? ` · ${cfg.rssi}dBm` : "";
      const upTxt = cfg.uptime_s !== undefined ? ` · up ${cfg.uptime_s}s` : "";
      armDetailEl.textContent = `Wi-Fi: ${cfg.wifi_ssid || "--"} · ${cfg.esp_ip || "--"}${rssiTxt}${upTxt}`;
    }
    if (trackBadgeEl) {
      trackBadgeEl.textContent = cfg.vision_seed_loop ? "VISION LOOP" : (cfg.vision_tracking ? "ALIGNING" : "Idle");
    }
    const loopPhaseEl = document.getElementById("vision-loop-phase");
    if (loopPhaseEl && cfg.vision_loop_phase) {
      loopPhaseEl.textContent = `Vision Loop: ${cfg.vision_loop_phase}`;
    }
    if (huskyIpInput && cfg.husky_ip && !huskyIpInput.value) {
      huskyIpInput.value = cfg.husky_ip;
    }
    if (railPosEl && cfg.rail_pos !== undefined) {
      railPosEl.textContent = `${cfg.rail_pos} steps (${cfg.last_command || "OK"})`;
    }
  });

  onValue(ref(db, 'vision_telemetry'), (snapshot) => {
    const vis = snapshot.val();
    if (!vis) return;
    const badgeEl = document.getElementById("husky-conn-badge");
    const targetEl = document.getElementById("husky-target-val");
    const condEl = document.getElementById("husky-condition-val");
    const coordsEl = document.getElementById("husky-coords-val");
    const algoEl = document.getElementById("husky-algo-label");
    const rtspEl = document.getElementById("husky-rtsp-url");

    const algoNames = { 1: "Face Recognition", 2: "Object Recognition", 4: "Color Recognition", 6: "Self-Learning", 16: "Tag Recognition", 18: "QR Code" };
    if (badgeEl) {
      badgeEl.innerHTML = `<span class="status-dot ${vis.connected ? "online" : "offline"}"></span>${vis.connected ? "Connected (MQTT)" : "Offline"}`;
    }
    if (condEl) {
      const condText = vis.plant_condition || (vis.detected ? (vis.name || `Class #${vis.tag_id}`) : "Empty / No Plant");
      condEl.textContent = `Condition: ${condText}`;
      condEl.style.color = condText.startsWith("Alert") ? "var(--danger, #dc2626)" : "var(--primary-dark)";
    }
    if (targetEl) {
      if (vis.detected) {
        const label = vis.name ? `${vis.name} (#${vis.tag_id})` : `ID #${vis.tag_id}`;
        targetEl.textContent = vis.centered ? `${label} · CENTERED` : label;
        targetEl.style.color = vis.centered ? "var(--primary-dark)" : "";
      } else {
        targetEl.textContent = "None";
        targetEl.style.color = "";
      }
    }
    if (coordsEl) {
      coordsEl.textContent = vis.detected
        ? `x=${vis.x_center}, y=${vis.y_center} (${vis.width}x${vis.height}) · dX=${vis.dx >= 0 ? "+" : ""}${vis.dx} px`
        : "Waiting for target in view…";
    }
    if (algoEl) {
      algoEl.textContent = `${algoNames[vis.algo] || ("Algo " + (vis.algo || 16))} (ID ${vis.algo || 16})`;
    }
    if (rtspEl) {
      rtspEl.textContent = vis.rtsp_url || "Set HuskyLens IP first";
    }
    state.huskyWebUrl = vis.web_url || (vis.ip ? `http://${vis.ip}` : "");
  });
}

// --- CLOUD COMMAND DISPATCHER ---
function dispatchCloudCommand(cmdString, actionType = "JOG", targetTray = "none", extraValue = null) {
  const isRawMovement = actionType === "JOG" || actionType === "RAW" || /^-?[XYABEZCG]\d+$/i.test(cmdString);
  const rawPayload = extraValue !== null ? String(extraValue) : cmdString;
  const commandId = (typeof crypto !== "undefined" && crypto.randomUUID) 
    ? crypto.randomUUID() 
    : ("cmd-" + Date.now() + "-" + Math.floor(Math.random() * 10000));
  
  const payload = {
    action: isRawMovement ? "RAW" : cmdString,
    raw_command: rawPayload,
    command: cmdString,
    cmd: cmdString,
    type: actionType,
    target_tray: targetTray,
    command_id: commandId,
    issued_at: Date.now(),
    timestamp: Date.now(),
    status: "QUEUED"
  };

  set(ref(db, "robot_command"), payload).catch((err) => console.error("Firebase Dispatch Error:", err));
  set(ref(db, "commands/base-esp"), payload).catch(() => {});

  // If Direct USB is connected, transmit command directly to Arduino Uno
  if (serialPort && serialWriter) {
    serialWriter.write(cmdString + "\n").catch((err) => console.error("Direct USB transmit error:", err));
    console.log("[USB OUT via Dispatcher]", cmdString);
  }
  
  push(ref(db, "activity"), {
    source: "Web portal",
    message: `Command dispatched: ${cmdString}`,
    status: "QUEUED",
    timestamp: Date.now()
  });

  addEvent("Web Portal", `Dispatched command [${cmdString}] to Firebase`, "Sent");
}

// --- WEB SERIAL API (USB CONTROL) ---
let serialPort = null;
let serialWriter = null;

async function connectUSB() {
  try {
    if (!("serial" in navigator)) {
      showToast("Web Serial API not supported in this browser. Please use Chrome or Edge.", "warning");
      return;
    }
    
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 115200 });
    
    const textEncoder = new TextEncoderStream();
    const writableStreamClosed = textEncoder.readable.pipeTo(serialPort.writable);
    serialWriter = textEncoder.writable.getWriter();
    
    document.getElementById("usb-status").textContent = "Connected (115200 baud)";
    document.getElementById("usb-status-dot").classList.replace("offline", "online");
    document.getElementById("arm-state").textContent = "Direct USB";
    showToast("USB Robot Connected Successfully!");
    addEvent("Web Serial", "Arduino USB connected", "Success");
    
  } catch (error) {
    console.error("USB Connection Error:", error);
    showToast("Failed to connect USB: " + error.message, "warning");
  }
}

async function writeSerial(command) {
  if (!serialPort || !serialWriter) {
    showToast("USB Robot not connected! Click 'Connect USB Robot' first.", "warning");
    return;
  }
  
  try {
    await serialWriter.write(command + "\n");
    console.log("[USB OUT]", command);
    showToast("USB Command Sent: " + command);
    addEvent("Web Serial", "Sent: " + command, "Sent");
  } catch (error) {
    console.error("Serial Write Error:", error);
    showToast("Error sending USB command.", "warning");
  }
}

// --- RENDERING FUNCTIONS ---
function renderAxes() {
  const grid = document.getElementById("axis-grid");
  grid.innerHTML = axes.map((axis) => `
    <div class="axis-control ${axis.key === "rail" ? "rail-axis" : ""}">
      <div class="axis-top"><span class="axis-name">${axis.label} <small>(${axis.controller})</small></span><span class="axis-position"><b id="axis-${axis.key}">${formatNumber(state.arm[axis.key])}</b> <span class="axis-unit">${axis.unit}</span></span></div>
      <div class="axis-actions">
        <button class="step-button" type="button" data-axis="${axis.key}" data-direction="-1" aria-label="Move ${axis.label} negative">-</button>
        <input class="step-input" id="step-${axis.key}" type="number" min="1" value="${axis.step}" aria-label="${axis.label} increment in ${axis.unit}" />
        <button class="step-button" type="button" data-axis="${axis.key}" data-direction="1" aria-label="Move ${axis.label} positive">+</button>
      </div>
    </div>
  `).join("") + `
    <div class="axis-control tool-axis">
      <div class="axis-top"><span class="axis-name">Tool / gripper <small>(Arduino Uno)</small></span><span class="axis-position"><b id="axis-gripper">${state.arm.gripper === 80 ? "Closed" : "Open"}</b></span></div>
      <div class="tool-actions"><button class="button secondary" type="button" data-gripper="0">${icon("unlock-keyhole")} Open · G0</button><button class="button primary" type="button" data-gripper="80">${icon("lock-keyhole")} Close · G80</button></div>
    </div>
  `;
  refreshIcons();
}

function renderRecordedSteps() {
  const target = document.getElementById("recorded-steps");
  const save = document.getElementById("save-routine");
  save.disabled = state.recordedSteps.length === 0;
  if (!state.recordedSteps.length) {
    target.innerHTML = `<div class="empty-state compact">${icon("mouse-pointer-click")}<p>Movement steps will appear here.</p></div>`;
  } else {
    target.innerHTML = state.recordedSteps.map((step, index) => `
      <div class="record-step"><span class="record-step-index">${String(index + 1).padStart(2, "0")}</span><strong>${step.axis}</strong><span>${step.direction > 0 ? "+" : ""}${step.amount} ${step.unit}</span></div>
    `).join("");
  }
  refreshIcons();
}

function moveAxis(key, direction) {
  const axis = axes.find((entry) => entry.key === key);
  const stepInput = document.getElementById(`step-${key}`);
  const amount = Math.max(1, Math.abs(Number(stepInput.value) || axis.step));
  const next = state.arm[key] + direction * amount;
  state.arm[key] = next;
  
  document.getElementById(`axis-${key}`).textContent = formatNumber(next);
  const command = `${axis.command}${direction > 0 ? "" : "-"}${amount}`;
  
  dispatchCloudCommand(command, "JOG");

  if (key === "rail") {
    state.lastRailCommand = command;
    updateRailMap();
  }
  
  // UPDATED: Now saves the actual hardware rawCommand string
  if (state.recording) {
    state.recordedSteps.push({ axis: axis.label, direction, amount, unit: axis.unit, rawCommand: command });
    renderRecordedSteps();
  }
  showToast(`Sent ${command} to physical hardware.`);
}

function updateRailMap() {
  document.getElementById("rail-position").textContent = state.lastRailCommand;
}

function selectSensor(sensor, log = true) {
  state.selectedSensor = sensor;
  const labels = { start: "Start / home", middle: "Middle / unit link", end: "End / rail limit" };
  document.querySelectorAll(".sensor-marker").forEach((button) => button.classList.toggle("active", button.dataset.sensor === sensor));
  document.getElementById("checkpoint-text").textContent = labels[sensor];
  const locations = { start: "0", middle: "calc(50% - 22px)", end: "calc(100% - 45px)" };
  document.getElementById("map-carriage").style.top = locations[sensor];
  if (log) {
    addEvent("Base ESP", `Physical IR gate [${labels[sensor]}] triggered`, "Confirmed");
    showToast(`Carriage confirmed at ${labels[sensor]}.`);
  }
}

function renderEvents() {
  const eventItems = state.events.slice(0, 4).map((event) => `
    <li><span class="event-dot ${event.status === "Warning" ? "warning" : ""}"></span><span><strong>${event.message}</strong><span>${event.source}</span></span><time>${event.time}</time></li>
  `).join("");
  const overviewEvents = document.getElementById("overview-events");
  if (overviewEvents) {
    overviewEvents.innerHTML = eventItems;
  }
  const activityTable = document.getElementById("activity-table");
  if (activityTable) {
    activityTable.innerHTML = state.events.map((event) => `
      <tr><td>${event.time}</td><td>${event.source}</td><td>${event.message}</td><td><span class="table-status ${event.status === "Warning" ? "warning" : ""}"><span class="status-dot ${event.status === "Warning" ? "" : "online"}"></span>${event.status}</span></td></tr>
    `).join("");
  }
}

function renderRoutines() {
  const library = document.getElementById("routine-library");
  const select = document.getElementById("job-routine");
  document.getElementById("routine-count").textContent = `${state.routines.length} routines`;
  if (!state.routines.length) {
    library.innerHTML = `<div class="empty-state"><p>No routines saved. Record a movement first.</p></div>`;
    select.innerHTML = `<option value="">No routines available</option>`;
  } else {
    library.innerHTML = state.routines.map((routine) => `
      <div class="routine-item"><div><h3>${routine.name}</h3><p>${routine.type} · ${routine.steps.length} movement steps · Updated ${routine.updated}</p></div><div class="routine-item-actions"><button class="icon-button run-routine" type="button" data-routine="${routine.id}" aria-label="Run ${routine.name}" data-tooltip="Run routine">${icon("play")}</button><button class="icon-button delete-routine" type="button" data-routine="${routine.id}" aria-label="Delete ${routine.name}" data-tooltip="Delete routine">${icon("trash-2")}</button></div></div>
    `).join("");
    select.innerHTML = state.routines.map((routine) => `<option value="${routine.id}">${routine.name}</option>`).join("");
  }
  refreshIcons();
}

function renderTrays() {
  const cards = document.getElementById("tray-cards");
  cards.innerHTML = state.trays.map((tray) => {
    if (tray.isHomeStation) {
      return `
        <article class="panel tray-card" style="border: 2px dashed #3a77a2; background: #f4f8fb;">
          <header class="tray-card-header" style="background: #e8f2f8;">
            <div>
              <span class="unit" style="color: #2b6c99;">Unit 1 · Right bay</span>
              <h3>Home Station & Tool Dock</h3>
            </div>
            <span class="chip" style="background: #d4e8f7; color: #185078; border-color: #aed0eb;">
              ${icon("home")} Home Station
            </span>
          </header>
          <div class="tray-card-body">
            <p style="margin: 0 0 14px; color: var(--muted); font-size: 13px; line-height: 1.5;">
              This bay is the physical <strong>Home Station, Dock & Calibration Zone</strong>. No moisture sensor is placed here to avoid false readings (GPIO 18 physical limit).
            </p>
            <div class="crop-selection">
              <div class="tray-stat"><span>Bay role</span><strong>Dock & Park</strong></div>
              <div class="tray-stat"><span>IR limit</span><strong>GPIO 18</strong></div>
              <div class="tray-stat"><span>Moisture</span><strong>None (Dock)</strong></div>
              <div class="tray-stat"><span>Valve Relay</span><strong>N/A</strong></div>
            </div>
            <div class="tray-actions">
              <button class="button secondary" type="button" onclick="dispatchCloudCommand('HOME_ARM', 'ROUTINE'); showToast('Carriage instructed to return Home.');">
                ${icon("home")} Home Carriage
              </button>
              <button class="button secondary" type="button" onclick="dispatchCloudCommand('R0', 'JOG'); showToast('Rail jogged to Position 0.');">
                ${icon("map-pin")} Rail Pos 0
              </button>
            </div>
          </div>
        </article>
      `;
    }

    return `
      <article class="panel tray-card">
        <header class="tray-card-header">
          <div>
            <span class="unit">${tray.unit} · ${tray.side}</span>
            <h3>${tray.crop === "Unassigned" ? "Available cultivation bay" : tray.crop}</h3>
          </div>
          <span class="chip ${tray.crop === "Unassigned" ? "" : tray.harvestReady ? "harvest-chip" : "success"}">
            ${tray.crop === "Unassigned" ? "Unplanted" : tray.harvestReady ? "Harvest ready" : tray.health}
          </span>
        </header>
        <div class="tray-card-body">
          <label class="field-label" for="crop-${tray.id}">Assigned crop</label>
          <select class="select-input crop-select" id="crop-${tray.id}" data-tray="${tray.id}">
            ${["Pak choi", "Lettuce", "Basil", "Microgreens", "Unassigned"].map((crop) => `<option ${tray.crop === crop ? "selected" : ""}>${crop}</option>`).join("")}
          </select>
          <div class="crop-selection">
            <div class="tray-stat"><span>Soil sensor (Pin ${tray.soilPin || 'N/A'})</span><strong>${tray.moisture !== null ? tray.moisture + '<small>%</small> · ' + (tray.soilStatus || (tray.moisture > 50 ? "Optimal" : "Dry")) : 'None'}</strong></div>
            <div class="tray-stat"><span>Valve (Pin ${tray.gpio || 'N/A'})</span><strong style="color:${tray.valve === 'Open' ? 'var(--primary)' : ''}">${tray.valve}</strong></div>
            <div class="tray-stat"><span>Growth days</span><strong>${tray.growthDays}</strong></div>
            <div class="tray-stat"><span>Vision status</span><strong>${tray.visionState || tray.lastCycle}</strong></div>
          </div>
          <div class="meter"><span style="width:${tray.moisture !== null ? tray.moisture : 0}%"></span></div>
          <div class="tray-actions">
            <button class="button ${tray.valve === 'Open' ? 'primary' : 'secondary'} valve-toggle-btn" data-tray="${tray.id}" type="button">
              ${icon("droplets")} ${tray.valve === "Open" ? "Close valve (Pin " + tray.gpio + ")" : "Open valve (Pin " + tray.gpio + ")"}
            </button>
            <button class="button secondary tray-task" data-tray="${tray.id}" data-action="${tray.crop === "Unassigned" ? "RESEED" : tray.harvestReady ? "HARVEST" : "INSPECT"}" type="button">
              ${icon(tray.crop === "Unassigned" ? "sprout" : tray.harvestReady ? "scissors" : "scan-line")} ${tray.crop === "Unassigned" ? "Prepare seeding" : tray.harvestReady ? "Queue harvest" : "Inspect canopy"}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join("");
  refreshIcons();
}

function updateTrayMap() {
  state.trays.forEach((tray) => {
    const map = document.getElementById(`map-moisture-${tray.id}`);
    if (map) {
      map.textContent = tray.isHomeStation ? "Dock" : `${tray.moisture}% (${tray.soilStatus || (tray.moisture > 50 ? "Moist" : "Dry")})`;
    }
    const crop = document.getElementById(`map-crop-${tray.id}`);
    if (crop) crop.textContent = tray.isHomeStation ? "Home Station" : tray.crop;
  });
}

function togglePump() {
  const next = !state.pumpRunning;
  const cmd = next ? "RUN_PUMP" : "STOP_PUMP";
  dispatchCloudCommand(cmd, "RELAY");
  updatePumpUI(next);
  showToast(next ? "Dispatched RUN_PUMP (Pin D6 ON)." : "Dispatched STOP_PUMP (Pin D6 OFF).");
}

function toggleValve(trayId) {
  const tray = state.trays.find(t => t.id === trayId);
  if (!tray || tray.isHomeStation) return;
  const isOpen = tray.valve === "Open";
  const next = !isOpen;
  tray.valve = next ? "Open" : "Closed";
  
  const cmd = next ? "VALVE_OPEN" : "VALVE_CLOSE";
  dispatchCloudCommand(cmd, "RELAY", tray.id);
  
  renderTrays();
  updateRelayStatusUI();
  showToast(`${tray.name} valve (Pin ${tray.gpio}): ${next ? "OPEN (ON)" : "CLOSED (OFF)"}`);
}

function openAllValves() {
  state.trays.forEach(tray => {
    if (!tray.isHomeStation) tray.valve = "Open";
  });
  dispatchCloudCommand("OPEN_ALL_VALVES", "RELAY");
  updatePumpUI(true);
  renderTrays();
  updateRelayStatusUI();
  showToast("Dispatched OPEN_ALL_VALVES (Valves D1, D2, D5 ON & Pump D6 ON).");
}

function closeAllRelays() {
  state.pumpRunning = false;
  state.trays.forEach(tray => {
    if (!tray.isHomeStation) tray.valve = "Closed";
  });
  dispatchCloudCommand("STOP_WATER", "RELAY");
  updatePumpUI(false);
  renderTrays();
  updateRelayStatusUI();
  showToast("Dispatched STOP_WATER: All valves & pump closed.");
}

// UPDATED: Saves the full array of recorded steps to memory
function saveRoutine() {
  const input = document.getElementById("routine-name");
  const name = input.value.trim() || "Untitled movement";
  if (!state.recordedSteps.length) return;
  
  state.routines.unshift({ 
    id: `routine-${Date.now()}`, 
    name, 
    type: "Custom", 
    steps: [...state.recordedSteps], // Copy the exact raw commands
    updated: "Just now" 
  });
  
  state.recordedSteps = [];
  state.recording = false;
  document.getElementById("record-toggle").innerHTML = `${icon("circle")}Start recording`;
  document.getElementById("recording-state").textContent = "Not recording";
  document.getElementById("recording-state").classList.remove("success");
  
  renderRecordedSteps();
  renderRoutines();
  showToast(`Saved ${name} to the routine library.`);
}

function exportLog() {
  const rows = [["Time", "Source", "Event", "Status"], ...state.events.map((event) => [event.time, event.source, event.message, event.status])];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "hydrohelp-activity-log.csv";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Activity log exported as CSV.");
}

function updateClock() {
  document.getElementById("live-clock").textContent = new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function simulateReadings() {
  const tweak = (value, distance) => Math.round((value + (Math.random() - .5) * distance) * 10) / 10;
  document.getElementById("ph-value").textContent = tweak(6.1, .16).toFixed(1);
  document.getElementById("ec-value").textContent = tweak(1.5, .09).toFixed(1);
  document.getElementById("temp-value").textContent = `${tweak(23.7, .55).toFixed(1)}°`;
  showToast("Latest sensor readings refreshed.");
}

function bindEvents() {
  document.querySelectorAll(".nav-item, [data-open-view]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view || button.dataset.openView));
  });
  
  document.getElementById("axis-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-axis]");
    if (button) moveAxis(button.dataset.axis, Number(button.dataset.direction));
    
    const gripper = event.target.closest("[data-gripper]");
    if (gripper) {
      state.arm.gripper = Number(gripper.dataset.gripper);
      document.getElementById("axis-gripper").textContent = state.arm.gripper === 80 ? "Closed" : "Open";
      
      const gripperCmd = `G${state.arm.gripper}`;
      dispatchCloudCommand(gripperCmd, "JOG");
      
      // UPDATED: Save raw gripper commands too
      if (state.recording) {
        state.recordedSteps.push({ axis: "Tool / gripper", direction: 1, amount: state.arm.gripper, unit: state.arm.gripper === 80 ? "close" : "open", rawCommand: gripperCmd });
        renderRecordedSteps();
      }
      showToast(`Sent ${gripperCmd} to Arduino Uno.`);
    }
  });

  document.querySelectorAll(".sensor-marker").forEach((button) => button.addEventListener("click", () => selectSensor(button.dataset.sensor)));
  
  document.querySelectorAll(".tray-map").forEach((button) => button.addEventListener("click", () => {
    setView("trays");
    document.getElementById(`crop-${button.dataset.tray}`).focus();
  }));

  document.getElementById("record-toggle").addEventListener("click", () => {
    state.recording = !state.recording;
    const button = document.getElementById("record-toggle");
    const badge = document.getElementById("recording-state");
    button.innerHTML = state.recording ? `${icon("square")}Stop recording` : `${icon("circle")}Start recording`;
    badge.textContent = state.recording ? "Recording" : "Not recording";
    badge.classList.toggle("success", state.recording);
    refreshIcons();
    showToast(state.recording ? "Movement recording started." : "Movement recording paused.");
  });

  document.getElementById("clear-recording").addEventListener("click", () => { state.recordedSteps = []; renderRecordedSteps(); showToast("Recorded movement steps cleared."); });
  document.getElementById("save-routine").addEventListener("click", saveRoutine);
  
  document.getElementById("start-patrol").addEventListener("click", () => {
    dispatchCloudCommand("MODE_AUTO", "STATE_CHANGE");
    update(ref(db, 'farm_config'), { system_mode: "AUTONOMOUS" });
    showToast("Dispatched MODE_AUTO. Firmware will patrol until IR gate tripped.");
  });

  document.querySelectorAll(".segmented button").forEach((button) => {
    button.addEventListener("click", () => {
      const isAuto = button.dataset.mode === "autonomous";
      const command = isAuto ? "MODE_AUTO" : "MODE_MANUAL";
      
      dispatchCloudCommand(command, "STATE_CHANGE");
      update(ref(db, 'farm_config'), { system_mode: isAuto ? "AUTONOMOUS" : "MANUAL" });
      showToast(`${command} selected.`, isAuto ? "warning" : "success");
    });
  });

  // --- PUMP & RELAY WEB CONTROL LISTENERS ---
  const togglePumpBtn = document.getElementById("toggle-pump");
  if (togglePumpBtn) togglePumpBtn.addEventListener("click", togglePump);

  const quickAllOffBtn = document.getElementById("btn-quick-all-off");
  if (quickAllOffBtn) quickAllOffBtn.addEventListener("click", closeAllRelays);

  const trayTogglePumpBtn = document.getElementById("btn-tray-toggle-pump");
  if (trayTogglePumpBtn) trayTogglePumpBtn.addEventListener("click", togglePump);

  const runAllValvesBtn = document.getElementById("run-all-valves");
  if (runAllValvesBtn) runAllValvesBtn.addEventListener("click", openAllValves);

  const closeAllRelaysBtn = document.getElementById("btn-close-all-relays");
  if (closeAllRelaysBtn) closeAllRelaysBtn.addEventListener("click", closeAllRelays);

  const manualPumpToggleBtn = document.getElementById("btn-manual-pump-toggle");
  if (manualPumpToggleBtn) manualPumpToggleBtn.addEventListener("click", togglePump);

  const manualOpenAllBtn = document.getElementById("btn-manual-open-all");
  if (manualOpenAllBtn) manualOpenAllBtn.addEventListener("click", openAllValves);

  const manualAllOffBtn = document.getElementById("btn-manual-all-off");
  if (manualAllOffBtn) manualAllOffBtn.addEventListener("click", closeAllRelays);

  const calibrateDryBtn = document.getElementById("btn-calibrate-dry");
  if (calibrateDryBtn) {
    calibrateDryBtn.addEventListener("click", () => {
      dispatchCloudCommand("CALIBRATE_DRY", "SYSTEM");
      showToast("Sent CALIBRATE_DRY to Base ESP. Dry sensors will zero to 0%.");
    });
  }

  const testRelaysBtn = document.getElementById("btn-test-relays");
  if (testRelaysBtn) {
    testRelaysBtn.addEventListener("click", () => {
      dispatchCloudCommand("TEST_RELAYS", "RELAY");
      showToast("Dispatched TEST_RELAYS: Base ESP will cycle Valve 1, 2, 3 and Pump for 1.2s each.");
    });
  }

  const manualTestRelaysBtn = document.getElementById("btn-manual-test-relays");
  if (manualTestRelaysBtn) {
    manualTestRelaysBtn.addEventListener("click", () => {
      dispatchCloudCommand("TEST_RELAYS", "RELAY");
      showToast("Dispatched TEST_RELAYS: Base ESP will cycle Valve 1, 2, 3 and Pump for 1.2s each.");
    });
  }

  const togglePolarityBtn = document.getElementById("btn-toggle-polarity");
  if (togglePolarityBtn) {
    togglePolarityBtn.addEventListener("click", () => {
      dispatchCloudCommand("TOGGLE_POLARITY", "RELAY");
      showToast("Dispatched TOGGLE_POLARITY: Flipping between Active LOW and Active HIGH.");
    });
  }

  const manualTogglePolarityBtn = document.getElementById("btn-manual-toggle-polarity");
  if (manualTogglePolarityBtn) {
    manualTogglePolarityBtn.addEventListener("click", () => {
      dispatchCloudCommand("TOGGLE_POLARITY", "RELAY");
      showToast("Dispatched TOGGLE_POLARITY: Flipping between Active LOW and Active HIGH.");
    });
  }

  document.querySelectorAll(".valve-manual-toggle").forEach((btn) => {
    btn.addEventListener("click", () => toggleValve(btn.dataset.tray));
  });

  document.getElementById("refresh-readings").addEventListener("click", simulateReadings);
  
  document.getElementById("queue-job").addEventListener("click", () => queueTask({ 
    trayId: document.getElementById("job-tray").value, 
    crop: document.getElementById("job-crop").value, 
    routineId: document.getElementById("job-routine").value, 
    action: document.getElementById("job-action").value 
  }));

  document.getElementById("job-tray").addEventListener("change", (event) => { 
    document.getElementById("route-destination").textContent = state.trays.find((tray) => tray.id === event.target.value).name; 
  });

  document.getElementById("new-job").addEventListener("click", () => setView("routines"));
  
  // UPDATED: Plays back the routine sequentially when clicking the "Play" icon
  document.getElementById("routine-library").addEventListener("click", async (event) => {
    const run = event.target.closest(".run-routine");
    const remove = event.target.closest(".delete-routine");
    if (run) { 
      const routine = state.routines.find((item) => item.id === run.dataset.routine);
      if (!routine || !routine.steps || routine.steps.length === 0) {
         showToast("This routine is empty. Record steps first.", "warning");
         return;
      }
      
      showToast(`Executing ${routine.name}... Please wait.`);
      
      // The Cloud Sequencer Loop
      for (let i = 0; i < routine.steps.length; i++) {
        const step = routine.steps[i];
        if (step.rawCommand) {
          dispatchCloudCommand(step.rawCommand, "JOG");
          // Wait 2.5 seconds for the physical arm to finish moving before sending the next command
          await new Promise(resolve => setTimeout(resolve, 2500));
        }
      }
      showToast(`${routine.name} completed successfully.`);
    }
    if (remove) { 
      state.routines = state.routines.filter((item) => item.id !== remove.dataset.routine); 
      renderRoutines(); 
      showToast("Routine removed from library."); 
    }
  });

  document.getElementById("tray-cards").addEventListener("change", (event) => {
    if (!event.target.matches(".crop-select")) return;
    const tray = state.trays.find((item) => item.id === event.target.dataset.tray);
    const newCrop = event.target.value;
    
    update(ref(db, `trays/${tray.id}`), {
      crop: newCrop,
      health: newCrop === "Unassigned" ? "N/A" : "Germinating",
      harvest_ready: false
    });
    showToast(`Updated Firebase: ${tray.name} crop set to ${newCrop}.`);
  });

  document.getElementById("tray-cards").addEventListener("click", (event) => {
    const valve = event.target.closest(".valve-toggle-btn") || event.target.closest(".valve-button");
    const trayTask = event.target.closest(".tray-task");
    
    if (valve) { 
      toggleValve(valve.dataset.tray); 
    }
    if (trayTask) {
      const tray = state.trays.find((item) => item.id === trayTask.dataset.tray);
      const action = trayTask.dataset.action;
      if (action === "RESEED" && tray.crop === "Unassigned") {
        setView("routines");
        document.getElementById("job-tray").value = tray.id;
        document.getElementById("route-destination").textContent = tray.name;
        document.getElementById("job-action").value = "RESEED";
        showToast(`Choose a crop, then queue a seeding task for ${tray.name}.`);
      } else {
        // Find the first available routine to attach to the task
        const routineId = state.routines.length > 0 ? state.routines[0].id : null;
        queueTask({ trayId: tray.id, crop: tray.crop, routineId, action });
      }
    }
  });

  const taskListEl = document.getElementById("task-list");
  if (taskListEl) {
    taskListEl.addEventListener("click", (event) => {
      const run = event.target.closest(".task-run");
      const remove = event.target.closest(".task-delete");
      if (run) runTask(run.dataset.task);
      if (remove) { state.tasks = state.tasks.filter((item) => item.id !== remove.dataset.task); if (typeof renderTasks === "function") renderTasks(); showToast("Task removed from queue."); }
    });
  }

  document.getElementById("run-queued-task").addEventListener("click", () => runTask());
  document.querySelectorAll(".close-modal").forEach((button) => button.addEventListener("click", () => { document.getElementById("task-modal").hidden = true; }));
  
  document.getElementById("open-connection").addEventListener("click", () => { document.getElementById("connection-modal").hidden = false; });
  document.querySelectorAll(".close-connection").forEach((button) => button.addEventListener("click", () => { document.getElementById("connection-modal").hidden = true; }));
  
  document.getElementById("emergency-stop").addEventListener("click", () => {
    state.taskRunning = false; 
    state.pumpRunning = false;
    
    dispatchCloudCommand("ESTOP", "SAFETY");
    
    document.getElementById("pump-state").textContent = "Stopped";
    document.getElementById("pump-detail").textContent = "Emergency stop active · valves closed";
    document.getElementById("arm-state").textContent = "Stopped";
    showToast("EMERGENCY STOP sent to Firebase. Verify physical machine.", "warning");
  });
  
  document.getElementById("export-log").addEventListener("click", exportLog);
  
  // --- USB, CLOUD ARM & HUSKYLENS 2 CONTROL LISTENERS ---
  const sendArmButtonCommand = (cmd, actionType = "ROUTINE", extra = null) => {
    dispatchCloudCommand(cmd, actionType, "none", extra);
    showToast(`Sent [${extra || cmd}] to Arm ESP32 / Uno.`);
  };

  const btnConnectUsb = document.getElementById("btn-connect-usb");
  if (btnConnectUsb) btnConnectUsb.addEventListener("click", connectUSB);

  const btnDemoLoop = document.getElementById("btn-demo-loop");
  if (btnDemoLoop) btnDemoLoop.addEventListener("click", () => sendArmButtonCommand("DEMO", "ROUTINE"));

  const btnVisionSeedLoop = document.getElementById("btn-vision-seed-loop");
  if (btnVisionSeedLoop) btnVisionSeedLoop.addEventListener("click", () => sendArmButtonCommand("VISION_SEED_LOOP", "VISION_SEED_LOOP"));

  const btnDemoHome = document.getElementById("btn-demo-home");
  if (btnDemoHome) btnDemoHome.addEventListener("click", () => sendArmButtonCommand("HOME_ARM"));

  const btnDemoInspect = document.getElementById("btn-demo-inspect");
  if (btnDemoInspect) btnDemoInspect.addEventListener("click", () => sendArmButtonCommand("VISION_POSE"));

  const btnDemoSeed = document.getElementById("btn-demo-seed");
  if (btnDemoSeed) btnDemoSeed.addEventListener("click", () => sendArmButtonCommand("1", "RAW"));

  const btnDemoDropSeed = document.getElementById("btn-demo-drop-seed");
  if (btnDemoDropSeed) btnDemoDropSeed.addEventListener("click", () => sendArmButtonCommand("-1", "RAW"));

  const btnDemoHarvest = document.getElementById("btn-demo-harvest");
  if (btnDemoHarvest) btnDemoHarvest.addEventListener("click", () => sendArmButtonCommand("TRAVEL_POSE"));

  const btnDemoClaw = document.getElementById("btn-demo-claw");
  if (btnDemoClaw) btnDemoClaw.addEventListener("click", () => sendArmButtonCommand("STOP"));

  // Manual Control raw command box & quick presets
  const rawInput = document.getElementById("cloud-raw-cmd");
  const sendRawInput = () => {
    if (!rawInput) return;
    const val = rawInput.value.trim();
    if (!val) return;
    sendArmButtonCommand(val, "RAW");
    rawInput.value = "";
  };
  const btnSendRaw = document.getElementById("btn-send-raw-cmd");
  if (btnSendRaw) btnSendRaw.addEventListener("click", sendRawInput);
  if (rawInput) rawInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendRawInput(); });

  const btnPreset1 = document.getElementById("btn-manual-preset-1");
  if (btnPreset1) btnPreset1.addEventListener("click", () => sendArmButtonCommand("1", "RAW"));
  const btnPresetNeg1 = document.getElementById("btn-manual-preset-neg1");
  if (btnPresetNeg1) btnPresetNeg1.addEventListener("click", () => sendArmButtonCommand("-1", "RAW"));
  const btnManualHome = document.getElementById("btn-manual-home");
  if (btnManualHome) btnManualHome.addEventListener("click", () => sendArmButtonCommand("HOME_ARM"));

  const teachBindings = [
    ["btn-teach-zero", "ZERO", "RAW"],
    ["btn-teach-hopper", "G901", "RAW"],
    ["btn-teach-left", "G902", "RAW"],
    ["btn-teach-right", "G903", "RAW"],
    ["btn-teach-close", "G904", "RAW"],
    ["btn-teach-open", "G905", "RAW"],
    ["btn-teach-demo", "DEMO", "ROUTINE"],
    ["btn-teach-stop", "STOP", "ROUTINE"]
  ];
  teachBindings.forEach(([id, cmd, type]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => sendArmButtonCommand(cmd, type));
  });

  // HuskyLens 2 Wi-Fi MQTT & Stream controls
  const btnSetHuskyIp = document.getElementById("btn-set-husky-ip");
  if (btnSetHuskyIp) {
    btnSetHuskyIp.addEventListener("click", () => {
      const ipInput = document.getElementById("husky-ip-input");
      const ip = ipInput ? ipInput.value.trim() : "";
      if (!ip) { showToast("Enter your HuskyLens 2 local IP first.", "warning"); return; }
      sendArmButtonCommand("SET_HUSKY_IP", "SET_HUSKY_IP", ip);
    });
  }
  const btnHuskyAlign = document.getElementById("btn-husky-align");
  if (btnHuskyAlign) btnHuskyAlign.addEventListener("click", () => sendArmButtonCommand("ALIGN_TAG"));
  const btnHuskyStop = document.getElementById("btn-husky-stop-track");
  if (btnHuskyStop) btnHuskyStop.addEventListener("click", () => sendArmButtonCommand("VISION_STOP"));
  const btnAlgoSelf = document.getElementById("btn-husky-algo-self");
  if (btnAlgoSelf) btnAlgoSelf.addEventListener("click", () => sendArmButtonCommand("HUSKY_ALGO", "HUSKY_ALGO", "6"));
  const btnAlgoColor = document.getElementById("btn-husky-algo-color");
  if (btnAlgoColor) btnAlgoColor.addEventListener("click", () => sendArmButtonCommand("HUSKY_ALGO", "HUSKY_ALGO", "4"));
  const btnAlgoTag = document.getElementById("btn-husky-algo-tag");
  if (btnAlgoTag) btnAlgoTag.addEventListener("click", () => sendArmButtonCommand("HUSKY_ALGO", "HUSKY_ALGO", "16"));
  const btnAlgoObj = document.getElementById("btn-husky-algo-obj");
  if (btnAlgoObj) btnAlgoObj.addEventListener("click", () => sendArmButtonCommand("HUSKY_ALGO", "HUSKY_ALGO", "2"));
  const btnHuskyOpen = document.getElementById("btn-husky-open-web");
  if (btnHuskyOpen) {
    btnHuskyOpen.addEventListener("click", () => {
      const ipInput = document.getElementById("husky-ip-input");
      const ip = ipInput ? ipInput.value.trim() : "";
      const url = state.huskyWebUrl || (ip ? `http://${ip}` : "");
      if (!url) { showToast("Enter HuskyLens IP and click Connect first.", "warning"); return; }
      window.open(url, "_blank", "noopener");
    });
  }
}

function init() {
  uiInitialized = true;
  try { bindEvents(); } catch (e) { console.error("Error binding events:", e); }
  try { initFirebaseListeners(); } catch (e) { console.error("Error initializing Firebase:", e); }
  try { renderAxes(); } catch (e) { console.error("Error rendering axes:", e); }
  try { renderRecordedSteps(); } catch (e) { console.error("Error rendering recorded steps:", e); }
  try { renderRoutines(); } catch (e) { console.error("Error rendering routines:", e); }
  try { renderTrays(); } catch (e) { console.error("Error rendering trays:", e); }
  try { renderTasks(); } catch (e) { console.error("Error rendering tasks:", e); }
  try { renderEvents(); } catch (e) { console.error("Error rendering events:", e); }
  try { updateRailMap(); } catch (e) { console.error("Error updating rail map:", e); }
  try { updateTrayMap(); } catch (e) { console.error("Error updating tray map:", e); }
  try { updatePumpUI(state.pumpRunning); } catch (e) { console.error("Error updating pump UI:", e); }
  try { updateRelayStatusUI(); } catch (e) { console.error("Error updating relay UI:", e); }
  try { updateClock(); } catch (e) { console.error("Error updating clock:", e); }
  try { refreshIcons(); } catch (e) { console.error("Error refreshing icons:", e); }
  setInterval(updateClock, 1000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}