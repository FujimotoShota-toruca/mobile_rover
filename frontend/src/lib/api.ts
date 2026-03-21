import type { BatteryStatus, BridgeResult, SessionInfo } from "../types";
import { API_BASE } from "./config";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json() as Promise<T>;
}

export async function getSessionInfo(sessionId: string): Promise<SessionInfo> {
  return fetchJson<SessionInfo>(`/api/sessions/${sessionId}`);
}

export async function bridgePing(baseUrl: string) {
  return fetchJson<BridgeResult>("/api/vehicle/ping", {
    method: "POST",
    body: JSON.stringify({ base_url: baseUrl }),
  });
}

export async function bridgeMove(baseUrl: string, move: string) {
  return fetchJson<BridgeResult>("/api/vehicle/move", {
    method: "POST",
    body: JSON.stringify({ base_url: baseUrl, move }),
  });
}

export async function bridgeBatteryStatus(baseUrl: string) {
  return fetchJson<BridgeResult<BatteryStatus>>("/api/vehicle/battery/status", {
    method: "POST",
    body: JSON.stringify({ base_url: baseUrl }),
  });
}

export async function bridgeBatteryAction(baseUrl: string, action: "start" | "stop" | "monitor") {
  return fetchJson<BridgeResult>(`/api/vehicle/battery/action/${action}`, {
    method: "POST",
    body: JSON.stringify({ base_url: baseUrl }),
  });
}

export async function bridgeBatterySet(baseUrl: string, targetCurrent: number) {
  return fetchJson<BridgeResult>("/api/vehicle/battery/set", {
    method: "POST",
    body: JSON.stringify({ base_url: baseUrl, target_current: targetCurrent }),
  });
}
