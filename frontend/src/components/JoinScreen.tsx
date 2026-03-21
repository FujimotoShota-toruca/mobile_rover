import type { Role } from "../types";

type Props = {
  sessionId: string;
  deviceId: string;
  role: Role;
  onSessionIdChange: (value: string) => void;
  onDeviceIdChange: (value: string) => void;
  onRoleChange: (value: Role) => void;
  onConnect: () => void;
};

export function JoinScreen(props: Props) {
  return (
    <div className="panel join-panel">
      <h1>Phone Web Telemetry Control Console</h1>
      <p>
        1つの URL にスマホと PC が入り、同じ session_id を共有します。<br />
        スマホ側は <code>mobile_sender</code>、PC 側は <code>pc_viewer</code> を選ぶと扱いやすいです。
      </p>

      <label>
        Session ID
        <input value={props.sessionId} onChange={(e) => props.onSessionIdChange(e.target.value)} />
      </label>

      <label>
        Device ID
        <input value={props.deviceId} onChange={(e) => props.onDeviceIdChange(e.target.value)} />
      </label>

      <label>
        Role
        <select value={props.role} onChange={(e) => props.onRoleChange(e.target.value as Role)}>
          <option value="mobile_sender">mobile_sender</option>
          <option value="pc_viewer">pc_viewer</option>
          <option value="admin">admin</option>
        </select>
      </label>

      <div className="row wrap-row">
        <button onClick={props.onConnect} className="accent-button">接続開始</button>
      </div>
    </div>
  );
}
