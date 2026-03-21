import { useMemo, useRef, useState } from "react";
import { JoinScreen } from "./components/JoinScreen";
import { MobilePanel } from "./components/MobilePanel";
import { PcDashboard } from "./components/PcDashboard";
import { SessionWsClient } from "./lib/ws";
import { WS_BASE } from "./lib/config";
import type { Envelope, Role } from "./types";

export default function App() {
  const [sessionId, setSessionId] = useState("lab-demo-001");
  const [deviceId, setDeviceId] = useState(() => `device-${Math.floor(Math.random() * 10000)}`);
  const [role, setRole] = useState<Role>("pc_viewer");
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Envelope[]>([]);
  const [connectionNote, setConnectionNote] = useState<string>("");
  const clientRef = useRef<SessionWsClient | null>(null);

  const wsUrl = `${WS_BASE}/ws/session/${sessionId}`;

  const lastMessage = useMemo(() => {
    return messages.length > 0 ? messages[messages.length - 1] : null;
  }, [messages]);

  const connect = () => {
    setConnectionNote(`connecting: ${wsUrl}`);

    const client = new SessionWsClient();
    clientRef.current = client;

    client.connect(
      wsUrl,
      (message) => {
        setMessages((prev) => [...prev, message]);
        if (message.type === "joined") {
          setConnected(true);
          setConnectionNote("");
        }
      },
      () => {
        setConnected(false);
        setConnectionNote("websocket closed");
      },
      () => {
        setConnectionNote(`websocket error: ${wsUrl}`);
      }
    );

    const tryJoin = window.setInterval(() => {
      try {
        client.send({
          type: "join",
          session_id: sessionId,
          device_id: deviceId,
          payload: {
            role,
            capabilities: {
              motion: role === "mobile_sender",
              orientation: role === "mobile_sender",
              camera: role === "mobile_sender",
            },
          },
        });
        window.clearInterval(tryJoin);
      } catch {
        // open を待つ
      }
    }, 100);
  };

  const send = (message: Envelope) => {
    clientRef.current?.send(message);
  };

  const disconnect = () => {
    clientRef.current?.close();
    clientRef.current = null;
    setConnected(false);
    setConnectionNote("");
  };

  return (
    <main className="app-root">
      <div className="topbar panel compact">
        <div><strong>session:</strong> {sessionId}</div>
        <div><strong>device:</strong> {deviceId}</div>
        <div><strong>role:</strong> {role}</div>
        <div><strong>connected:</strong> {String(connected)}</div>
        <div><strong>ws:</strong> {wsUrl}</div>
        {connectionNote && <div><strong>note:</strong> {connectionNote}</div>}
        {connected && <button onClick={disconnect}>切断</button>}
      </div>

      {!connected ? (
        <JoinScreen
          sessionId={sessionId}
          deviceId={deviceId}
          role={role}
          onSessionIdChange={setSessionId}
          onDeviceIdChange={setDeviceId}
          onRoleChange={setRole}
          onConnect={connect}
        />
      ) : role === "mobile_sender" ? (
        <MobilePanel sessionId={sessionId} deviceId={deviceId} send={send} lastMessage={lastMessage} />
      ) : (
        <PcDashboard sessionId={sessionId} deviceId={deviceId} messages={messages} lastMessage={lastMessage} send={send} />
      )}
    </main>
  );
}
