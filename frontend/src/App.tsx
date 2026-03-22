import { useMemo, useState } from "react";
import { MobilePage } from "./pages/MobilePage";
import { PcPage } from "./pages/PcPage";

type Role = "pc" | "mobile";

export default function App() {
  const [role, setRole] = useState<Role>("pc");

  const secureLabel = useMemo(() => (window.isSecureContext ? "secure" : "insecure"), []);

  return (
    <div className="app-shell">
      <header className="header hero-card card">
        <div>
          <h1>mobile_rover local-first WebRTC v1</h1>
          <p className="muted">
            公開HTTPSフロント + manual signaling + WebRTC DataChannel / video track の試作版。
          </p>
        </div>
        <div className="stack-gap align-end">
          <div className="badge-row">
            <span className="badge">context: {secureLabel}</span>
            <span className="badge">camera + telemetry + ack</span>
          </div>
          <div className="segmented">
            <button
              type="button"
              className={role === "pc" ? "selected" : ""}
              onClick={() => setRole("pc")}
            >
              PC Host
            </button>
            <button
              type="button"
              className={role === "mobile" ? "selected" : ""}
              onClick={() => setRole("mobile")}
            >
              Mobile Sensor
            </button>
          </div>
        </div>
      </header>

      {role === "pc" ? <PcPage /> : <MobilePage />}
    </div>
  );
}
