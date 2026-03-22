import { makeLogger } from "./logger.js";
import { BleUartBridge } from "./ble_bridge.js";
import { VehicleMedia } from "./vehicle_media.js";
import { FirestoreSignaling } from "./signaling_firestore.js";
import { RtcPeerSession } from "./rtc_peer.js";
import { AutonomyWsClient } from "./autonomy_ws.js";
import { clamp, makeDriveCommand, summarizeTelemetry } from "./protocol.js";

const els = {
  role: document.getElementById("role"),
  roomId: document.getElementById("roomId"),
  initBtn: document.getElementById("initBtn"),
  bleConnectBtn: document.getElementById("bleConnectBtn"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  localVideo: document.getElementById("localVideo"),
  remoteVideo: document.getElementById("remoteVideo"),
  statusBox: document.getElementById("statusBox"),
  securePill: document.getElementById("securePill"),
  blePill: document.getElementById("blePill"),
  rtcPill: document.getElementById("rtcPill"),
  autoPill: document.getElementById("autoPill"),
  logBox: document.getElementById("logBox"),
  telemetryPre: document.getElementById("telemetryPre"),
  picoState: document.getElementById("picoState"),
  batteryMv: document.getElementById("batteryMv"),
  gpsValue: document.getElementById("gpsValue"),
  headingValue: document.getElementById("headingValue"),
  controlPanel: document.getElementById("controlPanel"),
  vehiclePanel: document.getElementById("vehiclePanel"),
  controllerPanel: document.getElementById("controllerPanel"),
  manualModeBtn: document.getElementById("manualModeBtn"),
  autoModeBtn: document.getElementById("autoModeBtn"),
  estopBtn: document.getElementById("estopBtn"),
  pingBtn: document.getElementById("pingBtn"),
  forwardBtn: document.getElementById("forwardBtn"),
  leftBtn: document.getElementById("leftBtn"),
  stopDriveBtn: document.getElementById("stopDriveBtn"),
  rightBtn: document.getElementById("rightBtn"),
  backBtn: document.getElementById("backBtn"),
  autonomyUrl: document.getElementById("autonomyUrl"),
  autonomyConnectBtn: document.getElementById("autonomyConnectBtn"),
  autonomyDisconnectBtn: document.getElementById("autonomyDisconnectBtn"),
  autonomyStatus: document.getElementById("autonomyStatus")
};

const logger = makeLogger(els.logBox, els.statusBox);
const bleBridge = new BleUartBridge({
  onLine: handleBleLine,
  onStatus: (text) => {
    els.blePill.textContent = `BLE: ${text}`;
    logger.info(`BLE ${text}`);
  }
});
const vehicleMedia = new VehicleMedia({
  onStatus: (text) => logger.info(`MEDIA ${text}`)
});
const signaling = new FirestoreSignaling({ logger });
const rtc = new RtcPeerSession({
  logger,
  onRemoteStream: (stream) => {
    els.remoteVideo.srcObject = stream;
  },
  onChannel: handleChannelEvent
});
const autonomy = new AutonomyWsClient({
  onStatus: (text) => {
    els.autonomyStatus.textContent = text;
    logger.info(`AUTO-WS ${text}`);
  },
  onOutput: handleAutonomyOutput
});

const state = {
  seq: 0,
  mode: "MANUAL",
  started: false,
  controllerKeys: { w: false, a: false, s: false, d: false },
  currentTelemetry: { gps: null, imu: null, pico: null },
  latestAutoCommand: null,
  lastBleStat: null,
  timers: {
    commandLoop: null,
    telemetryLoop: null,
    autonomyLoop: null
  }
};

function isVehicle() {
  return els.role.value === "vehicle";
}

function isController() {
  return els.role.value === "controller";
}

function updateUiForRole() {
  els.vehiclePanel.classList.toggle("hidden", !isVehicle());
  els.controllerPanel.classList.toggle("hidden", !isController());
  els.controlPanel.classList.toggle("hidden", !isController());
}

function nextSeq() {
  state.seq += 1;
  return state.seq;
}

function updateTelemetryView() {
  const summary = summarizeTelemetry(state.currentTelemetry);
  els.picoState.textContent = summary.stateText;
  els.batteryMv.textContent = summary.batteryText;
  els.gpsValue.textContent = summary.gpsText;
  els.headingValue.textContent = summary.headingText;
  els.telemetryPre.textContent = JSON.stringify(state.currentTelemetry, null, 2);
}

function currentControllerCommand() {
  const keys = state.controllerKeys;
  let throttle = 0;
  let steering = 0;

  if (keys.w && !keys.s) throttle = 350;
  else if (keys.s && !keys.w) throttle = -300;

  if (keys.a && !keys.d) steering = -280;
  else if (keys.d && !keys.a) steering = 280;

  return makeDriveCommand({
    seq: nextSeq(),
    throttle,
    steering,
    ttlMs: 300,
    estop: false,
    mode: state.mode
  });
}

function setMode(mode) {
  state.mode = mode;
  els.autoPill.textContent = `AUTO: ${mode === "AUTO" ? "on" : "off"}`;
  logger.info(`mode=${mode}`);
  if (isController()) {
    rtc.sendJson("rpc", { type: "vehicle.mode", mode });
  }
  if (isVehicle() && bleBridge.connected) {
    bleBridge.sendMode(mode).catch((error) => logger.warn(`mode send failed: ${error.message}`));
  }
}

function handleBleLine(parsed, raw) {
  logger.info(`BLE RX ${raw}`);
  if (!parsed) return;
  if (parsed.type === "ble.stat") {
    state.lastBleStat = parsed;
    state.currentTelemetry.pico = {
      ackSeq: parsed.ackSeq,
      state: parsed.state,
      batteryMv: parsed.batteryMv,
      faults: parsed.faults,
      leftCmd: parsed.leftCmd,
      rightCmd: parsed.rightCmd,
      uptimeMs: parsed.uptimeMs
    };
    updateTelemetryView();

    if (isVehicle()) {
      rtc.sendJson("telemetry", {
        type: "vehicle.telemetry",
        ts: Date.now(),
        gps: state.currentTelemetry.gps,
        imu: state.currentTelemetry.imu,
        pico: state.currentTelemetry.pico,
        link: {
          ble: bleBridge.connected,
          rtc: rtc.pc?.connectionState || "idle"
        }
      });
    }
  }
}

function handleChannelEvent(label, kind, channel, rawData = null) {
  if (kind === "open") {
    els.rtcPill.textContent = `RTC: ${label} open`;
    return;
  }
  if (kind === "close") {
    els.rtcPill.textContent = `RTC: ${label} close`;
    return;
  }
  if (kind !== "message") return;

  let data;
  try {
    data = JSON.parse(rawData);
  } catch (error) {
    logger.warn(`bad JSON on ${label}: ${error.message}`);
    return;
  }

  if (label === "ctrl-fast" && isVehicle()) {
    if (!bleBridge.connected) {
      logger.warn("ctrl-fast arrived but BLE is not connected");
      return;
    }
    if (data.type === "drive.cmd") {
      bleBridge.sendDriveCommand(data).catch((error) => logger.warn(`BLE drive send failed: ${error.message}`));
    }
  }

  if (label === "rpc") {
    if (data.type === "vehicle.mode") {
      state.mode = String(data.mode || "MANUAL").toUpperCase();
      if (isVehicle() && bleBridge.connected) {
        bleBridge.sendMode(state.mode).catch((error) => logger.warn(`BLE mode send failed: ${error.message}`));
      }
      els.autoPill.textContent = `AUTO: ${state.mode === "AUTO" ? "on" : "off"}`;
    }
    if (data.type === "vehicle.ping" && isVehicle() && bleBridge.connected) {
      bleBridge.sendPing().catch((error) => logger.warn(`BLE ping failed: ${error.message}`));
    }
    if (data.type === "vehicle.estop" && isVehicle() && bleBridge.connected) {
      bleBridge.sendEstop().catch((error) => logger.warn(`BLE estop failed: ${error.message}`));
    }
  }

  if (label === "telemetry" && isController() && data.type === "vehicle.telemetry") {
    state.currentTelemetry = {
      gps: data.gps || null,
      imu: data.imu || null,
      pico: data.pico || null
    };
    updateTelemetryView();
  }
}

function handleAutonomyOutput(data) {
  if (data?.type !== "autonomy.output") return;
  state.latestAutoCommand = makeDriveCommand({
    seq: nextSeq(),
    throttle: clamp(Math.round((data.throttle ?? 0) * 1000), -1000, 1000),
    steering: clamp(Math.round((data.steering ?? 0) * 1000), -1000, 1000),
    ttlMs: 300,
    mode: "AUTO"
  });
  els.autonomyStatus.textContent = JSON.stringify(data, null, 2);
}

async function initializeVehicle() {
  await vehicleMedia.requestPermissions();
  await vehicleMedia.startCamera(els.localVideo);
  vehicleMedia.startSensors();
  state.currentTelemetry = { ...state.currentTelemetry, ...vehicleMedia.snapshot() };
  updateTelemetryView();
}

async function startSession() {
  const roomId = els.roomId.value.trim();
  if (!roomId) throw new Error("room ID を入力してください");
  if (state.started) throw new Error("すでに開始済みです");

  if (isVehicle()) {
    await initializeVehicle();
    const stream = vehicleMedia.stream;
    const pc = await rtc.prepareVehicle(stream);
    await signaling.startAsVehicle(pc, roomId);
    startVehicleTelemetryLoop();
  } else {
    const pc = await rtc.prepareController();
    await signaling.startAsController(pc, roomId);
    startControllerCommandLoop();
    startAutonomyLoop();
  }

  state.started = true;
  els.rtcPill.textContent = `RTC: starting (${els.role.value})`;
}

function startVehicleTelemetryLoop() {
  clearInterval(state.timers.telemetryLoop);
  state.timers.telemetryLoop = setInterval(() => {
    state.currentTelemetry = {
      ...state.currentTelemetry,
      ...vehicleMedia.snapshot(),
      pico: state.currentTelemetry.pico
    };
    updateTelemetryView();
    rtc.sendJson("telemetry", {
      type: "vehicle.telemetry",
      ts: Date.now(),
      gps: state.currentTelemetry.gps,
      imu: state.currentTelemetry.imu,
      pico: state.currentTelemetry.pico,
      link: {
        ble: bleBridge.connected,
        rtc: rtc.pc?.connectionState || "idle"
      }
    });
  }, 500);
}

function startControllerCommandLoop() {
  clearInterval(state.timers.commandLoop);
  state.timers.commandLoop = setInterval(() => {
    if (!state.started || !isController()) return;

    if (state.mode === "AUTO" && state.latestAutoCommand) {
      rtc.sendJson("ctrl-fast", { ...state.latestAutoCommand, seq: nextSeq(), ts: Date.now() });
      return;
    }

    const cmd = currentControllerCommand();
    rtc.sendJson("ctrl-fast", cmd);
  }, 100);
}

function captureVideoFrameBase64(videoEl) {
  if (!videoEl || videoEl.readyState < 2 || !videoEl.videoWidth || !videoEl.videoHeight) return null;
  const canvas = document.createElement("canvas");
  const width = 320;
  const height = Math.round((videoEl.videoHeight / videoEl.videoWidth) * width);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.55);
}

function startAutonomyLoop() {
  clearInterval(state.timers.autonomyLoop);
  state.timers.autonomyLoop = setInterval(() => {
    if (!isController()) return;
    const frame = captureVideoFrameBase64(els.remoteVideo);
    autonomy.send({
      type: "autonomy.input",
      ts: Date.now(),
      telemetry: state.currentTelemetry,
      frame
    });
  }, 500);
}

async function stopSession() {
  clearInterval(state.timers.commandLoop);
  clearInterval(state.timers.telemetryLoop);
  clearInterval(state.timers.autonomyLoop);
  state.timers.commandLoop = null;
  state.timers.telemetryLoop = null;
  state.timers.autonomyLoop = null;

  await signaling.stop();
  rtc.close();
  if (isVehicle()) {
    vehicleMedia.stop();
    els.localVideo.srcObject = null;
  }
  els.remoteVideo.srcObject = null;
  state.started = false;
  state.latestAutoCommand = null;
  els.rtcPill.textContent = "RTC: idle";
}

function setKeyState(key, pressed) {
  if (!(key in state.controllerKeys)) return;
  state.controllerKeys[key] = pressed;
}

els.role.addEventListener("change", updateUiForRole);

els.initBtn.addEventListener("click", async () => {
  try {
    els.securePill.textContent = `HTTPS: ${window.isSecureContext ? "ok" : "ng"}`;
    if (isVehicle()) {
      await initializeVehicle();
      logger.info("vehicle init complete");
    } else {
      logger.info("controller init complete");
    }
  } catch (error) {
    logger.error(`init failed: ${error.message}`);
  }
});

els.bleConnectBtn.addEventListener("click", async () => {
  try {
    await bleBridge.connect();
  } catch (error) {
    logger.error(`BLE connect failed: ${error.message}`);
  }
});

els.startBtn.addEventListener("click", async () => {
  try {
    await startSession();
    logger.info("session started");
  } catch (error) {
    logger.error(`start failed: ${error.message}`);
  }
});

els.stopBtn.addEventListener("click", async () => {
  try {
    await stopSession();
    logger.info("session stopped");
  } catch (error) {
    logger.error(`stop failed: ${error.message}`);
  }
});

els.manualModeBtn.addEventListener("click", () => setMode("MANUAL"));
els.autoModeBtn.addEventListener("click", () => setMode("AUTO"));

els.estopBtn.addEventListener("click", async () => {
  try {
    if (isController()) {
      rtc.sendJson("rpc", { type: "vehicle.estop" });
      rtc.sendJson("ctrl-fast", makeDriveCommand({ seq: nextSeq(), estop: true, mode: state.mode }));
    }
    if (isVehicle() && bleBridge.connected) {
      await bleBridge.sendEstop();
    }
  } catch (error) {
    logger.error(`estop failed: ${error.message}`);
  }
});

els.pingBtn.addEventListener("click", async () => {
  try {
    if (isController()) {
      rtc.sendJson("rpc", { type: "vehicle.ping" });
    }
    if (isVehicle() && bleBridge.connected) {
      await bleBridge.sendPing();
    }
  } catch (error) {
    logger.error(`ping failed: ${error.message}`);
  }
});

function setButtonDrive(throttle, steering) {
  state.latestAutoCommand = null;
  state.mode = "MANUAL";
  state.controllerKeys = { w: false, a: false, s: false, d: false };
  rtc.sendJson("ctrl-fast", makeDriveCommand({
    seq: nextSeq(),
    throttle,
    steering,
    ttlMs: 300,
    mode: state.mode
  }));
}

els.forwardBtn.addEventListener("click", () => setButtonDrive(350, 0));
els.backBtn.addEventListener("click", () => setButtonDrive(-300, 0));
els.leftBtn.addEventListener("click", () => setButtonDrive(0, -300));
els.rightBtn.addEventListener("click", () => setButtonDrive(0, 300));
els.stopDriveBtn.addEventListener("click", () => setButtonDrive(0, 0));

els.autonomyConnectBtn.addEventListener("click", () => autonomy.connect(els.autonomyUrl.value.trim()));
els.autonomyDisconnectBtn.addEventListener("click", () => autonomy.disconnect());

window.addEventListener("keydown", (event) => {
  if (!isController()) return;
  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (["input", "textarea", "select"].includes(activeTag)) return;
  const key = event.key.toLowerCase();
  if (["w", "a", "s", "d"].includes(key)) {
    event.preventDefault();
    setKeyState(key, true);
  }
  if (event.code === "Space") {
    event.preventDefault();
    state.controllerKeys = { w: false, a: false, s: false, d: false };
  }
});

window.addEventListener("keyup", (event) => {
  if (!isController()) return;
  const key = event.key.toLowerCase();
  if (["w", "a", "s", "d"].includes(key)) {
    event.preventDefault();
    setKeyState(key, false);
  }
});

window.addEventListener("beforeunload", () => {
  try { rtc.close(); } catch {}
  try { vehicleMedia.stop(); } catch {}
  try { autonomy.disconnect(); } catch {}
});

updateUiForRole();
els.securePill.textContent = `HTTPS: ${window.isSecureContext ? "ok" : "ng"}`;
updateTelemetryView();
logger.info("app ready");
