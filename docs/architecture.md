# Architecture

- 公開 HTTPS フロントをスマホと PC が開く
- Firestore は offer / answer / ICE candidate の signaling だけ担当する
- 実データの本流は WebRTC
  - video: media track
  - telemetry / command / ack: RTCDataChannel
- PC ローカル処理は `pc_agent/` に差し込む

## ねらい

- iPhone の camera / motion permission を HTTPS 上で通す
- 長い SDP を手コピペせず、room name + password で接続する
- backend 常駐を本流から外し、薄い signaling に寄せる
