import { useEffect, useRef, useState } from "react";
import { JsonBox } from "../components/JsonBox";
import { requestMotionPermissions, type PermissionStateLabel } from "../lib/permissions";
import { applyRemoteDescriptionBlob, createAnswerBlob } from "../lib/webrtc";
import type { RoverMessage } from "../types/messages";

function logLine(input: unknown): string {
  return typeof input === "string" ? input : JSON.stringify(input, null, 2);
}

export function MobilePage() {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const telemetryTimerRef = useRef<number | null>(null);
  const latestMotionRef = useRef<DeviceMotionEvent | null>(null);
  const latestOrientationRef = useRef<DeviceOrientationEvent | null>(null);

  const [connectionState, setConnectionState] = useState("new");
  const [iceState, setIceState] = useState("new");
  const [permissionState, setPermissionState] = useState<PermissionStateLabel>("idle");
  const [cameraState, setCameraState] = useState<"idle" | "active" | "error">("idle");
  const [offerBlob, setOfferBlob] = useState("");
  const [answerBlob, setAnswerBlob] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);

  const appendLog = (value: unknown) => {
    setLogs((prev) => [logLine(value), ...prev].slice(0, 50));
  };

  const handleMotion = (event: DeviceMotionEvent) => {
    latestMotionRef.current = event;
  };

  const handleOrientation = (event: DeviceOrientationEvent) => {
    latestOrientationRef.current = event;
  };

  const ensurePeer = () => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      dataChannelRef.current = channel;
      channel.onopen = () => appendLog({ info: "datachannel open" });
      channel.onclose = () => appendLog({ info: "datachannel close" });
      channel.onmessage = (message) => {
        const parsed = JSON.parse(message.data) as RoverMessage;
        appendLog(parsed);
        if (parsed.type === "command") {
          const ack = {
            type: "ack",
            commandId: parsed.commandId,
            status: "ok",
            message: `handled ${parsed.command}`,
            timestamp: Date.now(),
          } satisfies RoverMessage;
          channel.send(JSON.stringify(ack));
          appendLog(ack);
        }
      };
    };

    pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);
    pc.oniceconnectionstatechange = () => setIceState(pc.iceConnectionState);

    pcRef.current = pc;
    return pc;
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      const pc = ensurePeer();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      setCameraState("active");
      appendLog({ info: "camera started" });
    } catch (error) {
      console.error(error);
      setCameraState("error");
      appendLog({ error: "camera failed" });
    }
  };

  const beginStreaming = async () => {
    const permission = await requestMotionPermissions();
    setPermissionState(permission);
    if (permission !== "granted") return;

    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== "open") {
      appendLog({ error: "datachannel not open" });
      return;
    }

    window.addEventListener("devicemotion", handleMotion);
    window.addEventListener("deviceorientation", handleOrientation);

    telemetryTimerRef.current = window.setInterval(() => {
      if (channel.readyState !== "open") return;
      const motion = latestMotionRef.current;
      const orientation = latestOrientationRef.current;

      const payload = {
        type: "telemetry",
        deviceId: "mobile-001",
        timestamp: Date.now(),
        motion: {
          accel: {
            x: motion?.accelerationIncludingGravity?.x ?? 0,
            y: motion?.accelerationIncludingGravity?.y ?? 0,
            z: motion?.accelerationIncludingGravity?.z ?? 0,
          },
          rotationRate: {
            alpha: motion?.rotationRate?.alpha ?? 0,
            beta: motion?.rotationRate?.beta ?? 0,
            gamma: motion?.rotationRate?.gamma ?? 0,
          },
        },
        orientation: {
          alpha: orientation?.alpha ?? null,
          beta: orientation?.beta ?? null,
          gamma: orientation?.gamma ?? null,
        },
      } satisfies RoverMessage;

      channel.send(JSON.stringify(payload));
    }, 200);

    setStreaming(true);
    appendLog({ info: "telemetry started" });
  };

  const stopStreaming = () => {
    if (telemetryTimerRef.current !== null) {
      window.clearInterval(telemetryTimerRef.current);
      telemetryTimerRef.current = null;
    }
    window.removeEventListener("devicemotion", handleMotion);
    window.removeEventListener("deviceorientation", handleOrientation);
    setStreaming(false);
    appendLog({ info: "telemetry stopped" });
  };

  useEffect(() => {
    return () => {
      stopStreaming();
      dataChannelRef.current?.close();
      pcRef.current?.getSenders().forEach((sender) => sender.track?.stop());
      pcRef.current?.close();
    };
  }, []);

  return (
    <div className="grid cols-2 gap-lg">
      <section className="stack-gap">
        <div className="card stack-gap">
          <h2>Mobile Sensor status</h2>
          <div className="badge-row">
            <span className="badge">mobile.connection: {connectionState}</span>
            <span className="badge">mobile.ice: {iceState}</span>
            <span className="badge">permission: {permissionState}</span>
            <span className="badge">camera: {cameraState}</span>
            <span className="badge">streaming: {String(streaming)}</span>
          </div>
          <div className="button-row wrap">
            <button type="button" onClick={startCamera}>
              Start Camera
            </button>
            <button
              type="button"
              onClick={async () => {
                const pc = ensurePeer();
                await applyRemoteDescriptionBlob(pc, offerBlob);
                const answer = await createAnswerBlob(pc);
                setAnswerBlob(answer);
                appendLog({ info: "answer created" });
              }}
            >
              Accept Offer / Create Answer
            </button>
            <button type="button" onClick={beginStreaming}>
              Start Telemetry
            </button>
            <button type="button" onClick={stopStreaming}>
              Stop Telemetry
            </button>
          </div>
        </div>

        <JsonBox label="Remote Offer JSON" value={offerBlob} onChange={setOfferBlob} />
        <JsonBox label="Local Answer JSON" value={answerBlob} readOnly />

        <div className="card stack-gap">
          <h2>Local camera preview</h2>
          <video ref={localVideoRef} autoPlay muted playsInline className="video-box" />
        </div>
      </section>

      <section className="stack-gap">
        <div className="card stack-gap">
          <h2>Event log</h2>
          <div className="log-box">
            {logs.length === 0 ? (
              <p className="muted">No events yet</p>
            ) : (
              logs.map((line, index) => (
                <pre key={`${index}-${line.slice(0, 24)}`} className="log-line">
                  {line}
                </pre>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
