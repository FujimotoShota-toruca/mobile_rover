import { useEffect, useMemo, useRef, useState } from "react";
import { JsonBox } from "../components/JsonBox";
import { applyRemoteDescriptionBlob, createOfferBlob } from "../lib/webrtc";
import type { AckMessage, RoverMessage, TelemetryFrame } from "../types/messages";

function logLine(input: unknown): string {
  return typeof input === "string" ? input : JSON.stringify(input, null, 2);
}

export function PcPage() {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const hasVideoTransceiverRef = useRef(false);

  const [connectionState, setConnectionState] = useState("new");
  const [iceState, setIceState] = useState("new");
  const [iceGatheringState, setIceGatheringState] = useState("new");
  const [channelState, setChannelState] = useState("closed");
  const [offerBlob, setOfferBlob] = useState("");
  const [answerBlob, setAnswerBlob] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [latestTelemetry, setLatestTelemetry] = useState<TelemetryFrame | null>(null);
  const [latestAck, setLatestAck] = useState<AckMessage | null>(null);
  const [telemetryCount, setTelemetryCount] = useState(0);
  const [lastTelemetryTs, setLastTelemetryTs] = useState<number | null>(null);
  const [videoRotationDeg, setVideoRotationDeg] = useState(0);
  const [remoteVideoState, setRemoteVideoState] = useState<"idle" | "track" | "playing" | "error">("idle");

  const telemetryText = useMemo(() => {
    if (!latestTelemetry) return "No telemetry yet";
    return JSON.stringify(latestTelemetry, null, 2);
  }, [latestTelemetry]);

  const appendLog = (value: unknown) => {
    setLogs((prev) => [logLine(value), ...prev].slice(0, 80));
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
    };
    channel.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as RoverMessage;
      appendLog(parsed);
      if (parsed.type === "telemetry") {
        setLatestTelemetry(parsed);
        setTelemetryCount((prev) => prev + 1);
        setLastTelemetryTs(parsed.timestamp);
      }
      if (parsed.type === "ack") setLatestAck(parsed);
    };
    channel.onclose = () => {
      setChannelState(channel.readyState);
      appendLog({ info: "datachannel closed" });
    };
    channel.onerror = () => appendLog({ error: "datachannel error" });

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

  const prepareOffer = async () => {
    const pc = ensurePeer();
    if (!hasVideoTransceiverRef.current) {
      pc.addTransceiver("video", { direction: "recvonly" });
      hasVideoTransceiverRef.current = true;
      appendLog({ info: "video recvonly transceiver added" });
    }
    const blob = await createOfferBlob(pc);
    setOfferBlob(blob);
    appendLog({ info: "offer created" });
  };

  useEffect(() => {
    return () => {
      dataChannelRef.current?.close();
      pcRef.current?.close();
    };
  }, []);

  return (
    <div className="stack-gap">
      <div className="hero-card card">
        <div>
          <h2>PC Host</h2>
          <p className="muted">
            受信側。Offer作成前に video recvonly transceiver を自動追加し、スマホの映像を受ける。
          </p>
        </div>
        <div className="badge-row">
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
            <h3>Pairing</h3>
            <div className="button-row wrap">
              <button type="button" onClick={prepareOffer}>
                Create Offer
              </button>
              <button
                type="button"
                onClick={async () => {
                  const pc = ensurePeer();
                  await applyRemoteDescriptionBlob(pc, answerBlob);
                  appendLog({ info: "answer applied" });
                }}
              >
                Apply Answer
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
            </div>
            <p className="muted small">
              Mobile 側は Start Camera を先に押してから Accept Offer / Create Answer を実行してください。
            </p>
          </div>

          <JsonBox label="Local Offer JSON" value={offerBlob} readOnly />
          <JsonBox label="Remote Answer JSON" value={answerBlob} onChange={setAnswerBlob} />

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
