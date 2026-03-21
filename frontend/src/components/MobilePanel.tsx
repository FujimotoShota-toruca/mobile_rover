import { useEffect, useRef, useState } from "react";
import type { ControlMode, Envelope, SensorSample } from "../types";

type Props = {
  sessionId: string;
  deviceId: string;
  send: (message: Envelope) => void;
  lastMessage: Envelope | null;
};

declare global {
  interface DeviceMotionEvent {
    requestPermission?: () => Promise<"granted" | "denied">;
  }
  interface DeviceOrientationEvent {
    requestPermission?: () => Promise<"granted" | "denied">;
  }
}

const STUN_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export function MobilePanel({ sessionId, deviceId, send, lastMessage }: Props) {
  const [running, setRunning] = useState(false);
  const [permissionState, setPermissionState] = useState("not_requested");
  const [sensorIntervalMs, setSensorIntervalMs] = useState(250);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [commandNote, setCommandNote] = useState("waiting");
  const [controlMode, setControlMode] = useState<ControlMode>("manual");
  const latestSampleRef = useRef<SensorSample>({ ts: Date.now() });
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const peerTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!running) return;

    const handleMotion = (event: DeviceMotionEvent) => {
      latestSampleRef.current = {
        ...latestSampleRef.current,
        ts: Date.now(),
        motion: {
          accel: {
            x: event.accelerationIncludingGravity?.x ?? null,
            y: event.accelerationIncludingGravity?.y ?? null,
            z: event.accelerationIncludingGravity?.z ?? null,
          },
          gyro: {
            x: event.rotationRate?.alpha ?? null,
            y: event.rotationRate?.beta ?? null,
            z: event.rotationRate?.gamma ?? null,
          },
        },
      };
    };

    const handleOrientation = (event: DeviceOrientationEvent) => {
      latestSampleRef.current = {
        ...latestSampleRef.current,
        ts: Date.now(),
        orientation: {
          alpha: event.alpha ?? null,
          beta: event.beta ?? null,
          gamma: event.gamma ?? null,
        },
      };
    };

    window.addEventListener("devicemotion", handleMotion);
    window.addEventListener("deviceorientation", handleOrientation);

    const timer = window.setInterval(() => {
      send({
        type: "sensor_batch",
        session_id: sessionId,
        device_id: deviceId,
        payload: {
          sent_at: Date.now(),
          samples: [{ ...latestSampleRef.current }],
        },
      });
    }, sensorIntervalMs);

    return () => {
      window.removeEventListener("devicemotion", handleMotion);
      window.removeEventListener("deviceorientation", handleOrientation);
      window.clearInterval(timer);
    };
  }, [running, sensorIntervalMs, send, sessionId, deviceId]);

  const requestSensorPermission = async () => {
    try {
      const maybeMotionPermission = DeviceMotionEvent.requestPermission?.bind(DeviceMotionEvent);
      const maybeOrientationPermission = DeviceOrientationEvent.requestPermission?.bind(DeviceOrientationEvent);

      if (maybeMotionPermission) {
        const result = await maybeMotionPermission();
        if (result !== "granted") {
          setPermissionState("denied");
          return false;
        }
      }

      if (maybeOrientationPermission) {
        const result = await maybeOrientationPermission();
        if (result !== "granted") {
          setPermissionState("denied");
          return false;
        }
      }

      setPermissionState("granted");
      return true;
    } catch (error) {
      console.error(error);
      setPermissionState("error");
      return false;
    }
  };

  const publishDeviceState = (next: { cameraEnabled?: boolean; motionEnabled?: boolean }) => {
    send({
      type: "device_state",
      session_id: sessionId,
      device_id: deviceId,
      payload: {
        motion_enabled: next.motionEnabled ?? running,
        orientation_enabled: next.motionEnabled ?? running,
        camera_enabled: next.cameraEnabled ?? cameraEnabled,
        sensor_interval_ms: sensorIntervalMs,
        control_mode: controlMode,
      },
    });
  };

  const ensureCamera = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
      audio: false,
    });
    localStreamRef.current = stream;
    setCameraEnabled(true);
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
    }
    publishDeviceState({ cameraEnabled: true });
    return stream;
  };

  const stopCamera = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setCameraEnabled(false);
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    publishDeviceState({ cameraEnabled: false });
  };

  const closePeer = () => {
    peerRef.current?.close();
    peerRef.current = null;
    peerTargetRef.current = null;
  };

  const createPeer = async (targetDeviceId: string) => {
    if (peerRef.current && peerTargetRef.current === targetDeviceId) {
      return peerRef.current;
    }
    closePeer();
    const peer = new RTCPeerConnection(STUN_CONFIG);
    peerTargetRef.current = targetDeviceId;
    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      send({
        type: "ice_candidate",
        session_id: sessionId,
        device_id: deviceId,
        target_device_id: targetDeviceId,
        payload: { candidate: event.candidate.toJSON() },
      });
    };
    peer.onconnectionstatechange = () => {
      setCommandNote(`webrtc: ${peer.connectionState}`);
    };
    const stream = await ensureCamera();
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peerRef.current = peer;
    return peer;
  };

  const beginOffer = async (targetDeviceId: string) => {
    const peer = await createPeer(targetDeviceId);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    send({
      type: "offer",
      session_id: sessionId,
      device_id: deviceId,
      target_device_id: targetDeviceId,
      payload: { sdp: offer.sdp, type: offer.type },
    });
    setCommandNote(`offer sent to ${targetDeviceId}`);
  };

  const startStreaming = async () => {
    const granted = await requestSensorPermission();
    if (!granted) return;
    setRunning(true);
    publishDeviceState({ motionEnabled: true });
  };

  const stopStreaming = () => {
    setRunning(false);
    closePeer();
    stopCamera();
    publishDeviceState({ motionEnabled: false, cameraEnabled: false });
  };

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === "answer" && lastMessage.target_device_id === deviceId) {
      const peer = peerRef.current;
      const sdp = String(lastMessage.payload.sdp ?? "");
      const type = String(lastMessage.payload.type ?? "answer") as RTCSdpType;
      if (peer && sdp) {
        peer
          .setRemoteDescription(new RTCSessionDescription({ type, sdp }))
          .catch((error) => setCommandNote(`answer error: ${String(error)}`));
      }
      return;
    }

    if (lastMessage.type === "ice_candidate" && lastMessage.target_device_id === deviceId) {
      const peer = peerRef.current;
      const candidate = lastMessage.payload.candidate as RTCIceCandidateInit | undefined;
      if (peer && candidate) {
        peer.addIceCandidate(new RTCIceCandidate(candidate)).catch((error) => {
          setCommandNote(`ice error: ${String(error)}`);
        });
      }
      return;
    }

    if (lastMessage.type !== "command") return;
    if (lastMessage.target_device_id !== deviceId) return;

    const commandName = String(lastMessage.payload.command ?? "unknown");
    const params = (lastMessage.payload.params ?? {}) as Record<string, unknown>;

    const execute = async () => {
      try {
        if (commandName === "set_stream_config") {
          if (typeof params.sensor_interval_ms === "number") {
            setSensorIntervalMs(params.sensor_interval_ms);
          }
          if (typeof params.camera_enabled === "boolean") {
            if (params.camera_enabled) {
              await ensureCamera();
            } else {
              stopCamera();
            }
          }
        }

        if (commandName === "request_video_offer") {
          const requester = String(lastMessage.device_id ?? "");
          if (requester) {
            await beginOffer(requester);
          }
        }

        if (commandName === "toggle_camera") {
          const enable = Boolean(params.enabled);
          if (enable) {
            await ensureCamera();
          } else {
            stopCamera();
          }
        }

        setCommandNote(`accepted command: ${commandName}`);
        send({
          type: "ack",
          session_id: sessionId,
          device_id: deviceId,
          target_device_id: String(lastMessage.device_id ?? ""),
          payload: {
            cmd_id: lastMessage.payload.cmd_id,
            status: "ok",
            note: `accepted command: ${commandName}`,
            executed_at: Date.now(),
          },
        });
      } catch (error) {
        const message = String(error);
        setCommandNote(`command failed: ${message}`);
        send({
          type: "ack",
          session_id: sessionId,
          device_id: deviceId,
          target_device_id: String(lastMessage.device_id ?? ""),
          payload: {
            cmd_id: lastMessage.payload.cmd_id,
            status: "error",
            note: message,
            executed_at: Date.now(),
          },
        });
      }
    };

    void execute();
  }, [lastMessage, send, sessionId, deviceId]);

  return (
    <div className="dashboard-layout">
      <div className="stack-col">
        <section className="panel hero-panel">
          <div className="panel-header">
            <div>
              <h2>Mobile Sender</h2>
              <p>センサ送信・カメラ送信側です。PC から request_video_offer を受けると WebRTC offer を返します。</p>
            </div>
            <span className={`badge ${running ? "ok" : "idle"}`}>{running ? "streaming" : "idle"}</span>
          </div>
          <div className="row wrap-row">
            <button onClick={startStreaming}>センサ送信開始</button>
            <button onClick={stopStreaming} className="ghost-button">停止</button>
            <button onClick={() => void ensureCamera()} className="accent-button">カメラ起動</button>
            <button onClick={stopCamera} className="ghost-button">カメラ停止</button>
          </div>
          <div className="metric-grid compact-grid">
            <div className="metric-card"><span>permission</span><strong>{permissionState}</strong></div>
            <div className="metric-card"><span>interval</span><strong>{sensorIntervalMs} ms</strong></div>
            <div className="metric-card"><span>camera</span><strong>{String(cameraEnabled)}</strong></div>
            <div className="metric-card"><span>command</span><strong>{commandNote}</strong></div>
          </div>
        </section>

        <section className="panel">
          <h3>ローカル映像</h3>
          <div className="video-shell">
            <video ref={localVideoRef} autoPlay playsInline muted className="video-element" />
          </div>
        </section>
      </div>

      <div className="stack-col">
        <section className="panel">
          <h3>最新センサ</h3>
          <pre>{JSON.stringify(latestSampleRef.current, null, 2)}</pre>
        </section>

        <section className="panel">
          <h3>拡張インタフェース</h3>
          <label>
            Control Mode
            <select value={controlMode} onChange={(event) => setControlMode(event.target.value as ControlMode)}>
              <option value="manual">manual</option>
              <option value="vision_assist">vision_assist</option>
              <option value="sensor_fusion">sensor_fusion</option>
            </select>
          </label>
          <pre>{JSON.stringify({
            contract: {
              camera_frame_source: "WebRTC local video track",
              sensor_source: "sensor_batch",
              future_outputs: ["control_hint", "target_pose", "motor_command"],
            },
            current: { controlMode, sensorIntervalMs, cameraEnabled },
          }, null, 2)}</pre>
        </section>
      </div>
    </div>
  );
}
