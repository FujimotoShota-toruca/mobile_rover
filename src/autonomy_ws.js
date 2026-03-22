export class AutonomyWsClient {
  constructor({ onStatus = () => {}, onOutput = () => {} } = {}) {
    this.onStatus = onStatus;
    this.onOutput = onOutput;
    this.ws = null;
  }

  connect(url) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.onStatus(`connected: ${url}`);
    this.ws.onclose = () => this.onStatus("closed");
    this.ws.onerror = () => this.onStatus("error");
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.onOutput(data);
      } catch (error) {
        this.onStatus(`bad message: ${error.message}`);
      }
    };
  }

  disconnect() {
    if (this.ws) this.ws.close();
    this.ws = null;
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }
}
