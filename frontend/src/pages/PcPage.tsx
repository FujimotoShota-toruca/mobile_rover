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

  const [connectionState, setConnectionState] = useState("new");
  const [iceState, setIceState] = useState("new");
  const [offerBlob, setOfferBlob] = useState("");
  const [answerBlob, setAnswerBlob] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [latestTelemetry, setLatestTelemetry] = useState<TelemetryFrame | null>(null);
  const [latestAck, setLatestAck] = useState<AckMessage | null>(null);

  const telemetryText = useMemo(() => {
    if (!latestTelemetry) return "No telemetry yet";
    return JSON.stringify(latestTelemetry, null, 2);
  }, [latestTelemetry]);

  const appendLog = (value: unknown) => {
    setLogs((prev) => [logLine(value), ...prev].slice(0, 50));
  };

  const ensurePeer = () => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    const channel = pc.createDataChannel("rover");
    channel.onopen = () => appendLog({ info: "datachannel open" });
    channel.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as RoverMessage;
      appendLog(parsed);
      if (parsed.type === "telemetry") setLatestTelemetry(parsed);
      if (parsed.type === "ack") setLatestAck(parsed);
    };
    channel.onclose = () => appendLog({ info: "datachannel closed" });

    pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);
    pc.oniceconnectionstatechange = () => setIceState(pc.iceConnectionState);
    pc.ontrack = (event) => {
      if (!remoteVideoRef.current) return;
      const [stream] = event.streams;
      remoteVideoRef.current.srcObject = stream;
    };

    pcRef.current = pc;
    dataChannelRef.current = channel;
    return pc;
  };

  useEffect(() => {
    return () => {
      dataChannelRef.current?.close();
      pcRef.current?.close();
    };
  }, []);

  return (
    <div className="grid cols-2 gap-lg">
      <section className="stack-gap">
        <div className="card stack-gap">
          <h2>PC Host status</h2>
          <div className="badge-row">
            <span className="badge">pc.connection: {connectionState}</span>
            <span className="badge">pc.ice: {iceState}</span>
          </div>
          <div className="button-row wrap">
            <button
              type="button"
              onClick={async () => {
                const pc = ensurePeer();
                const blob = await createOfferBlob(pc);
                setOfferBlob(blob);
                appendLog({ info: "offer created" });
              }}
            >
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
        </div>

        <JsonBox label="Local Offer JSON" value={offerBlob} readOnly />
        <JsonBox label="Remote Answer JSON" value={answerBlob} onChange={setAnswerBlob} />

        <div className="card stack-gap">
          <h2>Latest telemetry</h2>
          <pre className="pre-box">{telemetryText}</pre>
        </div>

        <div className="card stack-gap">
          <h2>Latest ack</h2>
          <pre className="pre-box">
            {latestAck ? JSON.stringify(latestAck, null, 2) : "No ack yet"}
          </pre>
        </div>
      </section>

      <section className="stack-gap">
        <div className="card stack-gap">
          <h2>Remote video</h2>
          <video ref={remoteVideoRef} autoPlay playsInline controls className="video-box" />
        </div>
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
