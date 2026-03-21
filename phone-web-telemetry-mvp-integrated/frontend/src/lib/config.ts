function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

const browserHost = typeof window !== "undefined" ? window.location.hostname : "localhost";
const browserProtocol = typeof window !== "undefined" ? window.location.protocol : "http:";
const wsProtocol = browserProtocol === "https:" ? "wss" : "ws";
const httpProtocol = browserProtocol === "https:" ? "https" : "http";

const defaultApiBase = `${httpProtocol}://${browserHost}:8000`;
const defaultWsBase = `${wsProtocol}://${browserHost}:8000`;

export const API_BASE = trimTrailingSlash(import.meta.env.VITE_API_BASE ?? defaultApiBase);
export const WS_BASE = trimTrailingSlash(import.meta.env.VITE_WS_BASE ?? defaultWsBase);
