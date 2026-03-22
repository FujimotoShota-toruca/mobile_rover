# Architecture

## Goal

クラウド常駐 API サーバ中心ではなく、**PC を都度立ち上げるローカル実行主体**に再設計する。

## Data plane

- smartphone browser -> PC browser: WebRTC
- telemetry / command / ack: RTCDataChannel
- camera: MediaStream video track

## Control plane

- v0: manual signaling (offer / answer の手動受け渡し)
- v1: tiny signaling relay (optional)

## Processing plane

- PC browser: 現場確認・可視化
- PC local agent: 保存・vision・control・vehicle bridge

## Why this shape

- iPhone の sensor / camera permission は HTTPS secure context が必要
- WebRTC は P2P data/video に向く
- 重い処理は PC 側に寄せた方が自然
- クラウドは static frontend と signaling 補助だけでよい

