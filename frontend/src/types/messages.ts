export type TelemetryFrame = {
  type: "telemetry";
  deviceId: string;
  timestamp: number;
  motion: {
    accel: { x: number; y: number; z: number };
    rotationRate: { alpha: number; beta: number; gamma: number };
  };
  orientation: {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
  };
};

export type CommandMessage = {
  type: "command";
  commandId: string;
  command: string;
  params?: Record<string, unknown>;
  timestamp: number;
};

export type AckMessage = {
  type: "ack";
  commandId: string;
  status: "ok" | "error";
  message: string;
  timestamp: number;
};

export type RoverMessage = TelemetryFrame | CommandMessage | AckMessage;
