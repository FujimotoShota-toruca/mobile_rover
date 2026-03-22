import {
  doc,
  getDoc,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { db, isFirebaseConfigured } from "../lib/firebase";
import {
  appendIceCandidate,
  getCandidateCollection,
  getRoomRef,
  markRoomState,
  sha256Hex,
  type RoomRecord,
} from "../lib/room";
import { requestMotionPermissions, type PermissionStateLabel } from "../lib/permissions";
import type { RoverMessage } from "../types/messages";

function logLine(input: unknown): string {
  return typeof input === "string" ? input : JSON.stringify(input, null, 2);
}

export function MobilePage() {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callerCandidateUnsubRef = useRef<Unsubscribe | null>(null);
  const roomUnsubRef = useRef<Unsubscribe | null>(null);
  const remoteCandidateIdsRef = useRef<Set<string>>(new Set());
  const tracksAddedRef = useRef(false);
  const telemetryTimerRef = useRef<number | null>(null);
  const latestMotionRef = useRef<DeviceMotionEvent | null>(null);
  const latestOrientationRef = useRef<DeviceOrientationEvent | null>(null);

  const [roomName, setRoomName] = useState("carcam-01");
  const [password, setPassword] = useState("");
  const [connectionState, setConnectionState] = useState("new");
  const [iceState, setIceState] = useState("new");
  const [iceGatheringState, setIceGatheringState] = useState("new");
  const [channelState, setChannelState] = useState("closed");
  const [permissionState, setPermissionState] = useState<PermissionStateLabel>("idle");
  const [cameraState, setCameraState] = useState<"idle" | "active" | "error">("idle");
  const [streaming, setStreaming] = useState(false);
  const [packetCount, setPacketCount] = useState(0);
  const [lastTelemetryTs, setLastTelemetryTs] = useState<number | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [roomDocPreview, setRoomDocPreview] = useState<string>("No room yet");
  const [joinState, setJoinState] = useState("idle");

  const appendLog = (value: unknown) => {
    setLogs((prev) => [logLine(value), ...prev].slice(0, 120));
  };

  const handleMotion = (event: DeviceMotionEvent) => {
    latestMotionRef.current = event;
  };

  const handleOrientation = (event: DeviceOrientationEvent) => {
    latestOrientationRef.current = event;
  };

  const teardownSubscriptions = () => {
    callerCandidateUnsubRef.current?.();
    roomUnsubRef.current?.();
    callerCandidateUnsubRef.current = null;
    roomUnsubRef.current = null;
    remoteCandidateIdsRef.current.clear();
  };

  const teardownPeer = () => {
    dataChannelRef.current?.close();
    pcRef.current?.close();
    dataChannelRef.current = null;
    pcRef.current = null;
    setConnectionState("closed");
    setIceState("closed");
    setIceGatheringState("closed");
    setChannelState("closed");
    tracksAddedRef.current = false;
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

  const ensurePeer = () => {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.ondatachannel = (event) => {
      const channel = event.channel;
      dataChannelRef.current = channel;
      setChannelState(channel.readyState);
      appendLog({ info: "datachannel received" });
      channel.onopen = () => {
        setChannelState(channel.readyState);
        appendLog({ info: "datachannel open" });
        void syncRoomState({ mobileState: "connected" });
      };
      channel.onclose = () => {
        setChannelState(channel.readyState);
        appendLog({ info: "datachannel closed" });
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

  const syncRoomState = async (patch: Partial<RoomRecord>) => {
    if (!db) return;
    try {
      await markRoomState(db, roomName, patch);
    } catch (error) {
      console.error(error);
    }
  };

  const ensureCamera = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
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

  const joinRoom = async () => {
    if (!db) {
      appendLog({ error: "Firebase is not configured" });
      return;
    }
    if (!password.trim()) {
      appendLog({ error: "password is required" });
      return;
    }

    teardownSubscriptions();
    teardownPeer();

    const mediaReady = await addTracksIfNeeded();
    if (!mediaReady) return;

    const roomRef = getRoomRef(db, roomName);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) {
      appendLog({ error: "room does not exist" });
      return;
    }

    const roomData = roomSnap.data() as RoomRecord;
    setRoomDocPreview(JSON.stringify(roomData, null, 2));

    const passwordHash = await sha256Hex(password);
    if (roomData.passwordHash !== passwordHash) {
      appendLog({ error: "password mismatch" });
      setJoinState("password-mismatch");
      return;
    }

    const pc = ensurePeer();
    pc.onicecandidate = async (event) => {
      if (!event.candidate || !db) return;
      try {
        await appendIceCandidate(db, roomName, "calleeCandidates", event.candidate);
      } catch (error) {
        console.error(error);
        appendLog({ error: "failed to publish callee candidate" });
      }
    };

    if (!roomData.offer) {
      appendLog({ error: "offer missing in room" });
      return;
    }

    await pc.setRemoteDescription(roomData.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await markRoomState(db, roomName, {
      answer: pc.localDescription ?? answer,
      mobileState: "joined",
    });
    setJoinState("joined");
    appendLog({ info: "answer published" });

    roomUnsubRef.current = onSnapshot(roomRef, (snapshot) => {
      if (!snapshot.exists()) {
        setRoomDocPreview("Room deleted");
        return;
      }
      setRoomDocPreview(JSON.stringify(snapshot.data(), null, 2));
    });

    const remoteCandidatesRef = getCandidateCollection(db, roomName, "callerCandidates");
    callerCandidateUnsubRef.current = onSnapshot(remoteCandidatesRef, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== "added") return;
        if (remoteCandidateIdsRef.current.has(change.doc.id)) return;
        remoteCandidateIdsRef.current.add(change.doc.id);
        try {
          await pc.addIceCandidate(change.doc.data());
        } catch (error) {
          console.error(error);
          appendLog({ error: "failed to add caller candidate" });
        }
      });
    });
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
      if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") return;
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

      dataChannelRef.current.send(JSON.stringify(payload));
      setPacketCount((prev) => prev + 1);
      setLastTelemetryTs(payload.timestamp);
    }, 200);

    setStreaming(true);
    appendLog({ info: "telemetry started" });
  };

  useEffect(() => {
    return () => {
      stopStreaming();
      teardownSubscriptions();
      teardownPeer();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="stack-gap">
      <div className="hero-card card">
        <div>
          <h2>Mobile Sensor</h2>
          <p className="muted">
            同じ room name / password を入力して host に参加する。カメラ track を Answer に乗せ、telemetry / ack は DataChannel で送る。
          </p>
        </div>
        <div className="badge-row">
          <span className="badge">firebase: {isFirebaseConfigured() ? "configured" : "missing"}</span>
          <span className="badge">join: {joinState}</span>
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
            <h3>Room pairing</h3>
            <label className="field">
              <span>Room name</span>
              <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="carcam-01" />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder="shared secret"
              />
            </label>
            <div className="button-row wrap">
              <button type="button" onClick={() => void ensureCamera()}>
                Start Camera
              </button>
              <button type="button" onClick={() => void joinRoom()}>
                Join Room
              </button>
              <button type="button" onClick={() => void beginStreaming()}>
                Start Telemetry
              </button>
              <button type="button" onClick={stopStreaming}>
                Stop Telemetry
              </button>
            </div>
            <p className="muted small">
              iPhone / Safari ではページを前面に出している間に telemetry が安定しやすいです。
            </p>
          </div>

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

          <div className="card stack-gap">
            <h3>Room document</h3>
            <pre className="pre-box">{roomDocPreview}</pre>
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
