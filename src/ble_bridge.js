import { SERVICE_UUID, RX_UUID, TX_UUID, driveCommandToLine, parseBleLine } from "./protocol.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class BleUartBridge {
  constructor({ onLine = () => {}, onStatus = () => {} } = {}) {
    this.onLine = onLine;
    this.onStatus = onStatus;
    this.device = null;
    this.server = null;
    this.rxCharacteristic = null;
    this.txCharacteristic = null;
    this.rxBuffer = "";
    this.connected = false;
  }

  async connect() {
    this.onStatus("requesting device");
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID]
    });

    this.device.addEventListener("gattserverdisconnected", () => {
      this.connected = false;
      this.onStatus("disconnected");
    });

    this.server = await this.device.gatt.connect();
    const service = await this.server.getPrimaryService(SERVICE_UUID);
    this.rxCharacteristic = await service.getCharacteristic(RX_UUID);
    this.txCharacteristic = await service.getCharacteristic(TX_UUID);

    await this.txCharacteristic.startNotifications();
    this.txCharacteristic.addEventListener("characteristicvaluechanged", (event) => {
      const value = event.target.value;
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const text = textDecoder.decode(bytes);
      this.rxBuffer += text;
      let idx;
      while ((idx = this.rxBuffer.indexOf("\n")) >= 0) {
        const line = this.rxBuffer.slice(0, idx).trim();
        this.rxBuffer = this.rxBuffer.slice(idx + 1);
        if (!line) continue;
        const parsed = parseBleLine(line);
        this.onLine(parsed, line);
      }
    });

    this.connected = true;
    this.onStatus(`connected: ${this.device.name || "BLE device"}`);
  }

  async disconnect() {
    if (this.device?.gatt?.connected) {
      this.device.gatt.disconnect();
    }
    this.connected = false;
    this.onStatus("disconnected");
  }

  async writeText(text) {
    if (!this.rxCharacteristic) throw new Error("BLE characteristic not ready");
    const bytes = textEncoder.encode(text);
    // 安全側に 20byte チャンクで送る。
    for (let offset = 0; offset < bytes.length; offset += 20) {
      const chunk = bytes.slice(offset, offset + 20);
      await this.rxCharacteristic.writeValueWithoutResponse(chunk);
    }
  }

  async sendPing() {
    await this.writeText("PING\n");
  }

  async sendMode(mode) {
    await this.writeText(`MODE ${String(mode || "MANUAL").toUpperCase()}\n`);
  }

  async sendEstop() {
    await this.writeText("ESTOP\n");
  }

  async sendDriveCommand(cmd) {
    await this.writeText(driveCommandToLine(cmd));
  }
}
