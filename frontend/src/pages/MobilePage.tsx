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
  const localStreamRef = useRef<MediaStream | null>(null);
  const tracksAddedRef = useRef(false);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const telemetryTimerRef = useRef<number | null>(null);
  const latestMotionRef = useRef<DeviceMotionEvent | null>(null);
  const latestOrientationRef = useRef<DeviceOrientationEvent | null>(null);

  const [connectionState, setConnectionState] = useState("new");
  const [iceState, setIceState] = useState("new");
  const [iceGatheringState, setIceGatheringState] = useState("new");
  const [channelState, setChannelState] = useState("closed");
  const [permissionState, setPermissionState] = useState<PermissionStateLabel>("idle");
  const [cameraState, setCameraState] = useState<"idle" | "active" | "error">("idle");
  const [offerBlob, setOfferBlob] = useState("");
  const [answerBlob, setAnswerBlob] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [packetCount, setPacketCount] = useState(0);
  const [lastTelemetryTs, setLastTelemetryTs] = useState<number | null>(null);

  const appendLog = (value: unknown) => {
    setLogs((prev) => [logLine(value), ...prev].slice(0, 80));
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
      setChannelState(channel.readyState);
      channel.onopen = () => {
        setChannelState(channel.readyState);
        appendLog({ info: "datachannel open" });
      };
      channel.onclose = () => {
        setChannelState(channel.readyState);
        appendLog({ info: "datachannel close" });
      };
      channel.onerror = () => appendLog({ error: "datachannel error" });
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

    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      appendLog({ info: `pc.connectionState=${pc.connectionState}` });
    };
    pc.oniceconnectionstatechange = () => {
      setIceState(pc.iceConnectionState);
      appendLog({ info: `pc.iceConnectionState=${pc.iceConnectionState}` });
    };
    pc.onicegatheringstatechange = () => {
      setIceGatheringState(pc.iceGatheringState);
      appendLog({ info: `pc.iceGatheringState=${pc.iceGatheringState}` });
    };

    pcRef.current = pc;
    return pc;
  };

  const ensureCamera = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        localVideoRef.current.playsInline = true;
        await localVideoRef.current.play().catch(() => undefined);
      }
      setCameraState("active");
      appendLog({ info: "camera started" });
      return stream;
    } catch (error) {
      console.error(error);
      setCameraState("error");
      appendLog({ error: "camera failed" });
      return null;
    }
  };

  const addTracksIfNeeded = async () => {
    const pc = ensurePeer();
    const stream = await ensureCamera();
    if (!stream) return false;
    if (tracksAddedRef.current) return true;
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    tracksAddedRef.current = true;
    appendLog({ info: "local video track added" });
    return true;
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
      setPacketCount((prev) => prev + 1);
      setLastTelemetryTs(payload.timestamp);
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
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      pcRef.current?.close();
    };
  }, []);

  return (
    <div className="stack-gap">
      <div className="hero-card card">
        <div>
          <h2>Mobile Sensor</h2>
          <p className="muted">
            送信側。Start Camera を先に押し、映像トラックを追加した状態で Answer を生成してください。
          </p>
        </div>
        <div className="badge-row">
          <span className="badge">mobile.connection: {connectionState}</span>
          <span className="badge">mobile.ice: {iceState}</span>
          <span className="badge">mobile.gather: {iceGatheringState}</span>
          <span className="badge">dc: {channelState}</span>
          <span className="badge">permission: {permissionState}</span>
          <span className="badge">camera: {cameraState}</span>
          <span className="badge">streaming: {String(streaming)}</span>
        </div>
      </div>

      <div className="grid cols-2 gap-lg">
        <section className="stack-gap">
          <div className="card stack-gap">
            <h3>Pairing & media</h3>
            <div className="button-row wrap">
              <button type="button" onClick={ensureCamera}>
                Start Camera
              </button>
              <button
                type="button"
                onClick={async () => {
                  const pc = ensurePeer();
                  const mediaReady = await addTracksIfNeeded();
                  if (!mediaReady) return;
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
            <p className="muted small">
              telemetry は Safari を前面に出している間に安定して送られます。
            </p>
          </div>

          <JsonBox label="Remote Offer JSON" value={offerBlob} onChange={setOfferBlob} />
          <JsonBox label="Local Answer JSON" value={answerBlob} readOnly />

          <div className="card stack-gap">
            <div className="row-between">
              <h3>Local camera preview</h3>
              <div className="badge-row">
                <span className="badge">packets: {packetCount}</span>
                <span className="badge">last ts: {lastTelemetryTs ?? "-"}</span>
              </div>
            </div>
            <div className="video-stage">
              <video ref={localVideoRef} autoPlay muted playsInline className="video-box" />
            </div>
          </div>
        </section>

        <section className="stack-gap">
          <div className="card stack-gap">
            <h3>Event log</h3>
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
    </div>
  );
}
