export const SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
export const RX_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";
export const TX_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, digits = 3) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function makeDriveCommand({
  seq = 0,
  throttle = 0,
  steering = 0,
  ttlMs = 300,
  estop = false,
  mode = "MANUAL"
} = {}) {
  return {
    type: "drive.cmd",
    seq,
    mode,
    throttle: clamp(Math.round(throttle), -1000, 1000),
    steering: clamp(Math.round(steering), -1000, 1000),
    ttlMs: clamp(Math.round(ttlMs), 50, 3000),
    estop: Boolean(estop),
    ts: Date.now()
  };
}

export function driveCommandToLine(cmd) {
  if (cmd.estop) return "ESTOP\n";
  if (cmd.type !== "drive.cmd") throw new Error("invalid command type");
  return `DRIVE ${cmd.seq} ${cmd.throttle} ${cmd.steering} ${cmd.ttlMs} ${cmd.estop ? 1 : 0}\n`;
}

export function parseBleLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  const tag = parts[0]?.toUpperCase();

  if (tag === "PONG") {
    return { type: "ble.pong", uptimeMs: Number(parts[1] || 0), raw: trimmed };
  }

  if (tag === "STAT") {
    return {
      type: "ble.stat",
      ackSeq: Number(parts[1] || 0),
      state: parts[2] || "UNKNOWN",
      batteryMv: Number(parts[3] || 0),
      faults: Number(parts[4] || 0),
      leftCmd: Number(parts[5] || 0),
      rightCmd: Number(parts[6] || 0),
      uptimeMs: Number(parts[7] || 0),
      raw: trimmed
    };
  }

  if (tag === "INFO") {
    return { type: "ble.info", message: parts.slice(1).join(" "), raw: trimmed };
  }

  return { type: "ble.unknown", raw: trimmed };
}

export function normalizeGpsPosition(position) {
  if (!position?.coords) return null;
  const c = position.coords;
  return {
    lat: round(c.latitude, 7),
    lon: round(c.longitude, 7),
    speedMps: round(c.speed ?? 0, 3),
    headingDeg: round(c.heading ?? 0, 2),
    accuracyM: round(c.accuracy ?? 0, 1)
  };
}

export function summarizeTelemetry(data) {
  const gps = data?.gps;
  const pico = data?.pico;
  return {
    gpsText: gps ? `${gps.lat}, ${gps.lon}` : "-",
    headingText: gps?.headingDeg != null ? `${gps.headingDeg}°` : (data?.imu?.headingDeg != null ? `${data.imu.headingDeg}°` : "-"),
    stateText: pico?.state || "-",
    batteryText: pico?.batteryMv != null ? String(pico.batteryMv) : "-"
  };
}
