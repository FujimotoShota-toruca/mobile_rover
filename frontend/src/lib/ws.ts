import type { Envelope } from "../types";

export class SessionWsClient {
  private socket: WebSocket | null = null;

  connect(
    url: string,
    onMessage: (msg: Envelope) => void,
    onClose: () => void,
    onError?: () => void
  ) {
    this.socket = new WebSocket(url);
    this.socket.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as Envelope;
      onMessage(parsed);
    };
    this.socket.onerror = () => {
      onError?.();
    };
    this.socket.onclose = () => {
      onClose();
    };
    return this.socket;
  }

  send(message: Envelope) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("websocket is not open");
    }
    this.socket.send(JSON.stringify(message));
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }
}
