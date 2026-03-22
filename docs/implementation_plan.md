# Implementation plan

## v2 で入れたもの

- Firestore room signaling
- room name + password pairing
- host recvonly video transceiver
- mobile camera-first answer flow
- telemetry / command / ack over RTCDataChannel
- local / remote video, rotation, room document preview, event log

## 次にやること

1. room の期限切れ掃除
2. QR で room 情報共有
3. `pc_agent` と browser host の bridge
4. camera on/off の再交渉
5. Firestore rules の強化
