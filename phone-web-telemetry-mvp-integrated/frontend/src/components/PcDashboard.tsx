import { useEffect, useMemo, useRef, useState } from "react";
import {
  bridgeBatteryAction,
  bridgeBatterySet,
  bridgeBatteryStatus,
  bridgeMove,
  bridgePing,
  getSessionInfo,
} from "../lib/api";
import { SimpleLineChart } from "./SimpleLineChart";
import type { BatteryStatus, ControlMode, DeviceInfo, Envelope, SensorSample, SessionInfo } from "../types";

type Props = {
  sessionId: string;
  deviceId: string;
  messages: Envelope[];
  lastMessage: Envelope | null;
  send: (message: Envelope) => void;
};

type SensorHistory = {
  ax: number[];
  ay: number[];
  az: number[];
  gx: number[];
  gy: number[];
  gz: number[];
  alpha: number[];
  beta: number[];
  gamma: number[];
  latest?: SensorSample;
};

const emptyHistory = (): SensorHistory => ({
  ax: [],
  ay: [],
  az: [],
  gx: [],
  gy: [],
  gz: [],
  alpha: [],
  beta: [],
  gamma: [],
});

const push = (values: number[], value: number | null | undefined) => {
  const next = [...values, value ?? 0];
  return next.slice(-80);
};

const STUN_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export function PcDashboard({ sessionId, deviceId, messages, lastMessage, send }: Props) {
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [targetDeviceId, setTargetDeviceId] = useState("mobile-001");
  const [rotation, setRotation] = useState(0);
  const [commandLog, setCommandLog] = useState("未送信");
  const [batteryStatus, setBatteryStatus] = useState<BatteryStatus>({});
  const [bridgeBaseUrl, setBridgeBaseUrl] = useState("http://192.168.11.35");
  const [chargeTargetCurrent, setChargeTargetCurrent] = useState(0.3);
  const [controlMode, setControlMode] = useState<ControlMode>("manual");
  const [frameSampleMs, setFrameSampleMs] = useState(200);
  const [sensorHistory, setSensorHistory] = useState<Record<string, SensorHistory>>({});
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const peerTargetRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const info = await getSessionInfo(sessionId);
        if (!alive) return;
        setSessionInfo(info);
      } catch (error) {
        if (!alive) return;
        setCommandLog(`session fetch error: ${String(error)}`);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  useEffect(() => {
    const mobiles = (sessionInfo?.devices ?? []).filter((device) => device.role === "mobile_sender");
    if (!mobiles.length) return;
    if (mobiles.some((device) => device.device_id === targetDeviceId)) return;
    setTargetDeviceId(mobiles[0].device_id);
  }, [sessionInfo, targetDeviceId]);

  useEffect(() => {
    if (!lastMessage || lastMessage.type !== "sensor_batch") return;
    const sourceDeviceId = lastMessage.device_id;
    if (!sourceDeviceId) return;
    const sample = (lastMessage.payload.samples as SensorSample[] | undefined)?.[0];
    if (!sample) return;

    setSensorHistory((prev) => {
      const current = prev[sourceDeviceId] ?? emptyHistory();
      const next: SensorHistory = {
        ax: push(current.ax, sample.motion?.accel?.x),
        ay: push(current.ay, sample.motion?.accel?.y),
        az: push(current.az, sample.motion?.accel?.z),
        gx: push(current.gx, sample.motion?.gyro?.x),
        gy: push(current.gy, sample.motion?.gyro?.y),
        gz: push(current.gz, sample.motion?.gyro?.z),
        alpha: push(current.alpha, sample.orientation?.alpha),
        beta: push(current.beta, sample.orientation?.beta),
        gamma: push(current.gamma, sample.orientation?.gamma),
        latest: sample,
      };
      return { ...prev, [sourceDeviceId]: next };
    });
  }, [lastMessage]);

  const selectedHistory = sensorHistory[targetDeviceId] ?? emptyHistory();
  const latestSensor = selectedHistory.latest;
  const latestAck = useMemo(() => {
    return [...messages].reverse().find((msg) => msg.type === "ack");
  }, [messages]);

  const sendWsCommand = (command: string, params: Record<string, unknown> = {}) => {
    send({
      type: "command",
      session_id: sessionId,
      device_id: deviceId,
      target_device_id: targetDeviceId,
      payload: {
        cmd_id: `cmd-${Date.now()}`,
        command,
        params,
      },
    });
  };

  const createPeer = (target: string) => {
    if (peerRef.current && peerTargetRef.current === target) {
      return peerRef.current;
    }
    peerRef.current?.close();
    const peer = new RTCPeerConnection(STUN_CONFIG);
    peerTargetRef.current = target;
    peer.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };
    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      send({
        type: "ice_candidate",
        session_id: sessionId,
        device_id: deviceId,
        target_device_id: target,
        payload: { candidate: event.candidate.toJSON() },
      });
    };
    peer.onconnectionstatechange = () => {
      setCommandLog(`WebRTC ${peer.connectionState}`);
    };
    peerRef.current = peer;
    return peer;
  };

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === "offer" && lastMessage.target_device_id === deviceId) {
      const source = String(lastMessage.device_id ?? "");
      const sdp = String(lastMessage.payload.sdp ?? "");
      const type = String(lastMessage.payload.type ?? "offer") as RTCSdpType;
      if (!source || !sdp) return;
      const apply = async () => {
        const peer = createPeer(source);
        await peer.setRemoteDescription(new RTCSessionDescription({ type, sdp }));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        send({
          type: "answer",
          session_id: sessionId,
          device_id: deviceId,
          target_device_id: source,
          payload: { sdp: answer.sdp, type: answer.type },
        });
        setCommandLog(`answer sent to ${source}`);
      };
      void apply().catch((error) => setCommandLog(`offer handling error: ${String(error)}`));
      return;
    }

    if (lastMessage.type === "ice_candidate" && lastMessage.target_device_id === deviceId) {
      const source = String(lastMessage.device_id ?? "");
      const candidate = lastMessage.payload.candidate as RTCIceCandidateInit | undefined;
      if (!source || !candidate) return;
      const peer = createPeer(source);
      void peer.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
        setCommandLog(`ice handling error: ${String(error)}`);
      });
    }
  }, [lastMessage, deviceId, sessionId, send]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (activeTag === "input" || activeTag === "textarea" || activeTag === "select") {
        return;
      }
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "w") {
        event.preventDefault();
        void performMove("forward");
      } else if (key === "a") {
        event.preventDefault();
        void performMove("left");
      } else if (key === "s") {
        event.preventDefault();
        void performMove("back");
      } else if (key === "d") {
        event.preventDefault();
        void performMove("right");
      } else if (event.code === "Space") {
        event.preventDefault();
        void performMove("stop");
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [bridgeBaseUrl]);

  const performMove = async (move: "forward" | "back" | "left" | "right" | "stop") => {
    const result = await bridgeMove(bridgeBaseUrl, move);
    setCommandLog(`${move} -> ${JSON.stringify(result.payload)}`);
  };

  const refreshBattery = async () => {
    const result = await bridgeBatteryStatus(bridgeBaseUrl);
    setBatteryStatus(result.payload);
    setCommandLog(`battery/status -> ${JSON.stringify(result.payload)}`);
  };

  const mobileDevices = (sessionInfo?.devices ?? []).filter((device) => device.role === "mobile_sender");

  return (
    <div className="dashboard-layout">
      <div className="stack-col wide-col">
        <section className="panel hero-panel">
          <div className="panel-header">
            <div>
              <h2>PC Dashboard</h2>
              <p>参照サイトの構成に寄せて、映像・制御・電池・ログを1画面に集約しました。</p>
            </div>
            <span className="badge ok">viewer</span>
          </div>
          <div className="inline-grid">
            <label>
              監視対象デバイス
              <select value={targetDeviceId} onChange={(event) => setTargetDeviceId(event.target.value)}>
                {mobileDevices.map((device) => (
                  <option key={device.device_id} value={device.device_id}>{device.device_id}</option>
                ))}
              </select>
            </label>
            <label>
              Control Mode
              <select value={controlMode} onChange={(event) => setControlMode(event.target.value as ControlMode)}>
                <option value="manual">manual</option>
                <option value="vision_assist">vision_assist</option>
                <option value="sensor_fusion">sensor_fusion</option>
              </select>
            </label>
            <label>
              Frame Sample [ms]
              <input type="number" min={50} step={10} value={frameSampleMs} onChange={(event) => setFrameSampleMs(Number(event.target.value))} />
            </label>
          </div>
          <div className="row wrap-row">
            <button onClick={() => sendWsCommand("ping")}>ping</button>
            <button onClick={() => sendWsCommand("set_stream_config", { sensor_interval_ms: 100, camera_enabled: true })}>高速配信</button>
            <button onClick={() => sendWsCommand("request_video_offer", { frame_sample_ms: frameSampleMs })} className="accent-button">受信開始</button>
            <button onClick={() => sendWsCommand("toggle_camera", { enabled: true })}>カメラON</button>
            <button onClick={() => sendWsCommand("toggle_camera", { enabled: false })} className="ghost-button">カメラOFF</button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h3>受信映像</h3>
            <div className="row wrap-row small-gap">
              {[0, 90, 180, 270].map((deg) => (
                <button key={deg} onClick={() => setRotation(deg)} className={rotation === deg ? "accent-button" : "ghost-button"}>{deg}°</button>
              ))}
            </div>
          </div>
          <div className="video-shell">
            <video ref={remoteVideoRef} autoPlay playsInline className="video-element" style={{ transform: `rotate(${rotation}deg)` }} />
          </div>
        </section>

        <section className="panel">
          <h3>各種センサ可視化</h3>
          <div className="metric-grid">
            <div className="metric-card"><span>accel</span><strong>{formatVec(latestSensor?.motion?.accel)}</strong></div>
            <div className="metric-card"><span>gyro</span><strong>{formatVec(latestSensor?.motion?.gyro)}</strong></div>
            <div className="metric-card"><span>orientation</span><strong>{formatAngles(latestSensor)}</strong></div>
          </div>
          <div className="chart-grid">
            <SimpleLineChart title="Accel X" values={selectedHistory.ax} />
            <SimpleLineChart title="Accel Y" values={selectedHistory.ay} />
            <SimpleLineChart title="Accel Z" values={selectedHistory.az} />
            <SimpleLineChart title="Gyro α" values={selectedHistory.gx} />
            <SimpleLineChart title="Gyro β" values={selectedHistory.gy} />
            <SimpleLineChart title="Gyro γ" values={selectedHistory.gz} />
            <SimpleLineChart title="Orientation α" values={selectedHistory.alpha} />
            <SimpleLineChart title="Orientation β" values={selectedHistory.beta} />
            <SimpleLineChart title="Orientation γ" values={selectedHistory.gamma} />
          </div>
        </section>
      </div>

      <div className="stack-col narrow-col">
        <section className="panel">
          <h3>接続中デバイス</h3>
          <div className="device-list">
            {(sessionInfo?.devices ?? []).map((device: DeviceInfo) => (
              <div key={device.device_id} className={`device-pill ${device.device_id === targetDeviceId ? "selected" : ""}`}>
                <strong>{device.device_id}</strong>
                <span>{device.role}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h3>Pico W 操作</h3>
          <label>
            Bridge Base URL
            <input value={bridgeBaseUrl} onChange={(event) => setBridgeBaseUrl(event.target.value)} />
          </label>
          <div className="row wrap-row">
            <button onClick={() => void bridgePing(bridgeBaseUrl).then((result) => setCommandLog(`ping -> ${JSON.stringify(result.payload)}`))}>接続確認</button>
          </div>
          <div className="control-grid">
            <div className="empty-slot" />
            <button onClick={() => void performMove("forward")} className="direction-button">前進</button>
            <div className="empty-slot" />
            <button onClick={() => void performMove("left")} className="direction-button">左</button>
            <button onClick={() => void performMove("stop")} className="danger-button">停止</button>
            <button onClick={() => void performMove("right")} className="direction-button">右</button>
            <div className="empty-slot" />
            <button onClick={() => void performMove("back")} className="direction-button">後退</button>
            <div className="empty-slot" />
          </div>
          <p className="subtle-text">キーボード: W/A/S/D/Space で HTTP bridge に移動コマンドを送ります。</p>
        </section>

        <section className="panel">
          <h3>充電管理</h3>
          <label>
            目標充電電流 [A]
            <input type="number" step={0.01} min={0.05} max={1.0} value={chargeTargetCurrent} onChange={(event) => setChargeTargetCurrent(Number(event.target.value))} />
          </label>
          <div className="row wrap-row">
            <button onClick={() => void bridgeBatterySet(bridgeBaseUrl, chargeTargetCurrent).then((result) => setCommandLog(`battery/set -> ${JSON.stringify(result.payload)}`))}>設定反映</button>
            <button onClick={() => void bridgeBatteryAction(bridgeBaseUrl, "start").then((result) => setCommandLog(`battery/start -> ${JSON.stringify(result.payload)}`))} className="accent-button">充電開始</button>
            <button onClick={() => void bridgeBatteryAction(bridgeBaseUrl, "stop").then((result) => setCommandLog(`battery/stop -> ${JSON.stringify(result.payload)}`))} className="danger-button">充電停止</button>
            <button onClick={() => void bridgeBatteryAction(bridgeBaseUrl, "monitor").then((result) => setCommandLog(`battery/monitor -> ${JSON.stringify(result.payload)}`))}>監視</button>
            <button onClick={() => void refreshBattery()}>更新</button>
          </div>
          <div className="metric-grid compact-grid">
            <div className="metric-card"><span>state</span><strong>{String(batteryStatus.state ?? "-")}</strong></div>
            <div className="metric-card"><span>vbat</span><strong>{formatNumber(batteryStatus.vbat)} V</strong></div>
            <div className="metric-card"><span>current</span><strong>{formatNumber(batteryStatus.current)} A</strong></div>
            <div className="metric-card"><span>temp</span><strong>{formatNumber(batteryStatus.temp)} °C</strong></div>
            <div className="metric-card"><span>duty</span><strong>{formatNumber(batteryStatus.duty)} %</strong></div>
            <div className="metric-card"><span>target</span><strong>{formatNumber(batteryStatus.target_current ?? chargeTargetCurrent)} A</strong></div>
          </div>
        </section>

        <section className="panel">
          <h3>制御拡張インタフェース</h3>
          <pre>{JSON.stringify({
            selectedVideoSource: targetDeviceId,
            controlMode,
            frameSampleMs,
            hookContract: {
              image_features: ["bbox", "centroid", "heading_estimate"],
              sensor_features: ["accel", "gyro", "orientation"],
              outputs: ["ws command", "vehicle bridge move", "future MPC input"],
            },
          }, null, 2)}</pre>
        </section>

        <section className="panel">
          <h3>コマンド送信ログ</h3>
          <pre>{commandLog}</pre>
        </section>

        <section className="panel">
          <h3>Latest ACK</h3>
          <pre>{JSON.stringify(latestAck, null, 2)}</pre>
        </section>

        <section className="panel">
          <h3>Event Log</h3>
          <div className="log-box">
            {[...messages].reverse().slice(0, 24).map((msg, idx) => (
              <pre key={idx}>{JSON.stringify(msg, null, 2)}</pre>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function formatNumber(value: unknown) {
  return typeof value === "number" ? value.toFixed(3) : "-";
}

function formatVec(vec: { x: number | null; y: number | null; z: number | null } | undefined) {
  if (!vec) return "-";
  return [vec.x, vec.y, vec.z].map((value) => formatNumber(value)).join(", ");
}

function formatAngles(sample: SensorSample | undefined) {
  if (!sample?.orientation) return "-";
  return [sample.orientation.alpha, sample.orientation.beta, sample.orientation.gamma]
    .map((value) => formatNumber(value))
    .join(", ");
}
