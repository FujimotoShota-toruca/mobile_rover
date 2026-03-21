export type Role = "mobile_sender" | "pc_viewer" | "admin";

export type MessageType =
  | "join"
  | "joined"
  | "sensor_batch"
  | "device_state"
  | "command"
  | "ack"
  | "offer"
  | "answer"
  | "ice_candidate"
  | "heartbeat"
  | "error";

export type Envelope = {
  type: MessageType;
  session_id: string;
  device_id?: string;
  target_device_id?: string;
  payload: Record<string, unknown>;
};

export type Vec3 = { x: number | null; y: number | null; z: number | null };

export type SensorSample = {
  ts: number;
  motion?: {
    accel?: Vec3;
    gyro?: Vec3;
  };
  orientation?: {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
  };
};

export type DeviceInfo = {
  device_id: string;
  role: Role;
  capabilities: Record<string, unknown>;
  last_seen_at: number;
};

export type SessionInfo = {
  session_id: string;
  devices: DeviceInfo[];
  latest_sensor: Record<string, { sent_at?: number; samples?: SensorSample[] }>;
};

export type BatteryStatus = {
  state?: string;
  vbat?: number;
  current?: number;
  temp?: number;
  duty?: number;
  target_current?: number;
  [key: string]: unknown;
};

export type BridgeResult<T = Record<string, unknown>> = {
  ok: boolean;
  url?: string;
  payload: T;
};

export type ControlMode = "manual" | "vision_assist" | "sensor_fusion";
