import {
  doc,
  getDoc,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, isFirebaseConfigured } from "../lib/firebase";
import {
  appendIceCandidate,
  cleanupRoomArtifacts,
  createOrResetRoom,
  getCandidateCollection,
  getRoomRef,
  markRoomState,
  sha256Hex,
  type RoomRecord,
} from "../lib/room";
import type { AckMessage, RoverMessage, TelemetryFrame } from "../types/messages";

function logLine(input: unknown): string {
  return typeof input === "string" ? input : JSON.stringify(input, null, 2);
}

async function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const handler = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", handler);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", handler);
  });
}

export function PcPage() {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const roomUnsubRef = useRef<Unsubscribe | null>(null);
  const candidateUnsubRef = useRef<Unsubscribe | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const hasVideoTransceiverRef = useRef(false);
  const remoteCandidateIdsRef = useRef<Set<string>>(new Set());

  const [roomName, setRoomName] = useState("carcam-01");
  const [password, setPassword] = useState("");
  const [connectionState, setConnectionState] = useState("new");
  const [iceState, setIceState] = useState("new");
  const [iceGatheringState, setIceGatheringState] = useState("new");
  const [channelState, setChannelState] = useState("closed");
  const [roomState, setRoomState] = useState("idle");
  const [remoteVideoState, setRemoteVideoState] = useState<"idle" | "track" | "playing" | "error">("idle");
  const [telemetryCount, setTelemetryCount] = useState(0);
  const [lastTelemetryTs, setLastTelemetryTs] = useState<number | null>(null);
  const [videoRotationDeg, setVideoRotationDeg] = useState(0);
  const [latestTelemetry, setLatestTelemetry] = useState<TelemetryFrame | null>(null);
  const [latestAck, setLatestAck] = useState<AckMessage | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [roomDocPreview, setRoomDocPreview] = useState<string>("No room yet");

  const telemetryText = useMemo(() => {
    if (!latestTelemetry) return "No telemetry yet";
    return JSON.stringify(latestTelemetry, null, 2);
  }, [latestTelemetry]);

  const appendLog = (value: unknown) => {
    setLogs((prev) => [logLine(value), ...prev].slice(0, 120));
  };

  const teardownSubscriptions = () => {
    roomUnsubRef.current?.();
    candidateUnsubRef.current?.();
    roomUnsubRef.current = null;
    candidateUnsubRef.current = null;
    remoteCandidateIdsRef.current.clear();
  };

  const teardownPeer = () => {
    dataChannelRef.current?.close();
    pcRef.current?.close();
    dataChannelRef.current = null;
    pcRef.current = null;
    hasVideoTransceiverRef.current = false;
    setChannelState("closed");
    setConnectionState("closed");
    setIceState("closed");
    setIceGatheringState("closed");
    setRemoteVideoState("idle");
  };

  const ensurePeer = () => {
    if (pcRef.current) return pcRef.current;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    const channel = pc.createDataChannel("rover");
    channel.onopen = () => {
      setChannelState(channel.readyState);
      appendLog({ info: "datachannel open" });
      void syncRoomState({ hostState: "connected" });
    };
    channel.onclose = () => {
      setChannelState(channel.readyState);
      appendLog({ info: "datachannel closed" });
    };
    channel.onerror = () => appendLog({ error: "datachannel error" });
    channel.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as RoverMessage;
      appendLog(parsed);
      if (parsed.type === "telemetry") {
        setLatestTelemetry(parsed);
        setTelemetryCount((prev) => prev + 1);
        setLastTelemetryTs(parsed.timestamp);
      }
      if (parsed.type === "ack") {
        setLatestAck(parsed);
      }
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
    pc.ontrack = async (event) => {
      if (!remoteVideoRef.current) return;
      const [stream] = event.streams;
      remoteVideoRef.current.srcObject = stream;
      remoteVideoRef.current.autoplay = true;
      remoteVideoRef.current.playsInline = true;
      remoteVideoRef.current.muted = true;
      setRemoteVideoState("track");
      appendLog({ info: "remote video track attached" });
      try {
        await remoteVideoRef.current.play();
        setRemoteVideoState("playing");
        appendLog({ info: "remote video playing" });
      } catch (error) {
        console.error(error);
        setRemoteVideoState("error");
        appendLog({ error: "remote video play failed" });
      }
    };

    pcRef.current = pc;
    dataChannelRef.current = channel;
    setChannelState(channel.readyState);
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

  const beginListening = async () => {
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
    setTelemetryCount(0);
    setLastTelemetryTs(null);
    setLatestTelemetry(null);
    setLatestAck(null);

    const pc = ensurePeer();
    if (!hasVideoTransceiverRef.current) {
      pc.addTransceiver("video", { direction: "recvonly" });
      hasVideoTransceiverRef.current = true;
      appendLog({ info: "video recvonly transceiver added" });
    }

    pc.onicecandidate = async (event) => {
      if (!event.candidate || !db) return;
      try {
        await appendIceCandidate(db, roomName, "callerCandidates", event.candidate);
      } catch (error) {
        console.error(error);
        appendLog({ error: "failed to publish caller candidate" });
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    const passwordHash = await sha256Hex(password);
    await createOrResetRoom(db, roomName, passwordHash, pc.localDescription ?? offer);
    setRoomState("waiting-answer");
    appendLog({ info: "room created/reset" });

    const roomRef = getRoomRef(db, roomName);
    roomUnsubRef.current = onSnapshot(roomRef, async (snapshot) => {
      if (!snapshot.exists()) {
        setRoomDocPreview("Room deleted");
        return;
      }
      const data = snapshot.data() as RoomRecord;
      setRoomDocPreview(JSON.stringify(data, null, 2));
      if (data.answer && !pc.currentRemoteDescription) {
        await pc.setRemoteDescription(data.answer);
        appendLog({ info: "answer applied from Firestore" });
        setRoomState("connected-awaiting-media");
      }
    });

    const remoteCandidatesRef = getCandidateCollection(db, roomName, "calleeCandidates");
    candidateUnsubRef.current = onSnapshot(remoteCandidatesRef, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== "added") return;
        if (remoteCandidateIdsRef.current.has(change.doc.id)) return;
        remoteCandidateIdsRef.current.add(change.doc.id);
        try {
          await pc.addIceCandidate(change.doc.data());
        } catch (error) {
          console.error(error);
          appendLog({ error: "failed to add callee candidate" });
        }
      });
    });
  };

  const resetRoom = async () => {
    if (!db) return;
    teardownSubscriptions();
    teardownPeer();
    await cleanupRoomArtifacts(db, roomName);
    setRoomState("idle");
    setRoomDocPreview("Room deleted");
    appendLog({ info: "room reset" });
  };

  useEffect(() => {
    return () => {
      teardownSubscriptions();
      teardownPeer();
    };
  }, []);

  return (
    <div className="stack-gap">
      <div className="hero-card card">
        <div>
          <h2>PC Host</h2>
          <p className="muted">
            Firestore の room signaling を使って受信側の接続を待つ。カメラは remote video として受け、telemetry / ack は DataChannel で受ける。
          </p>
        </div>
        <div className="badge-row">
          <span className="badge">firebase: {isFirebaseConfigured() ? "configured" : "missing"}</span>
          <span className="badge">room: {roomState}</span>
          <span className="badge">pc.connection: {connectionState}</span>
          <span className="badge">pc.ice: {iceState}</span>
          <span className="badge">pc.gather: {iceGatheringState}</span>
          <span className="badge">dc: {channelState}</span>
          <span className="badge">video: {remoteVideoState}</span>
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
              <button type="button" onClick={() => void beginListening()}>
                Create / Reset Room
              </button>
              <button
                type="button"
                onClick={() => {
                  const channel = dataChannelRef.current;
                  if (!channel || channel.readyState !== "open") {
                    appendLog({ error: "datachannel not open" });
                    return;
                  }
                  const payload = {
                    type: "command",
                    commandId: `cmd-${Date.now()}`,
                    command: "ping",
                    params: { message: "hello from pc" },
                    timestamp: Date.now(),
                  } satisfies RoverMessage;
                  channel.send(JSON.stringify(payload));
                  appendLog(payload);
                }}
              >
                Send Ping
              </button>
              <button type="button" onClick={() => void resetRoom()}>
                Close Room
              </button>
            </div>
            <p className="muted small">
              送信側スマホでは同じ room name / password を入力し、Start Camera のあと Join Room を押してください。
            </p>
          </div>

          <div className="card stack-gap">
            <div className="row-between">
              <h3>Telemetry</h3>
              <div className="badge-row">
                <span className="badge">count: {telemetryCount}</span>
                <span className="badge">last ts: {lastTelemetryTs ?? "-"}</span>
              </div>
            </div>
            <pre className="pre-box">{telemetryText}</pre>
          </div>

          <div className="card stack-gap">
            <h3>Latest ack</h3>
            <pre className="pre-box">
              {latestAck ? JSON.stringify(latestAck, null, 2) : "No ack yet"}
            </pre>
          </div>

          <div className="card stack-gap">
            <h3>Room document</h3>
            <pre className="pre-box">{roomDocPreview}</pre>
          </div>
        </section>

        <section className="stack-gap">
          <div className="card stack-gap">
            <div className="row-between">
              <h3>Remote video</h3>
              <div className="button-row wrap compact">
                <button type="button" onClick={() => setVideoRotationDeg(0)}>0°</button>
                <button type="button" onClick={() => setVideoRotationDeg(90)}>90°</button>
                <button type="button" onClick={() => setVideoRotationDeg(180)}>180°</button>
                <button type="button" onClick={() => setVideoRotationDeg(270)}>270°</button>
              </div>
            </div>
            <div className="video-stage">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted
                controls
                className="video-box"
                style={{ transform: `rotate(${videoRotationDeg}deg)` }}
              />
            </div>
          </div>

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
