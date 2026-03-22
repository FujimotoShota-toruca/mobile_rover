import { useState } from "react";
import { MobilePage } from "./pages/MobilePage";
import { PcPage } from "./pages/PcPage";

type Role = "pc" | "mobile";

export default function App() {
  const [role, setRole] = useState<Role>("pc");

  return (
    <div className="app-shell">
      <header className="header">
        <div>
          <h1>mobile_rover local-first WebRTC v0</h1>
          <p className="muted">
            backend なしの manual signaling でスマホ↔PC を直結する試作版
          </p>
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
      </header>

      {role === "pc" ? <PcPage /> : <MobilePage />}
    </div>
  );
}
