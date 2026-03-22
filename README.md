# mobile_rover local-first WebRTC v2

公開 HTTPS フロントをスマホと PC が開き、Firestore を signaling にだけ使って WebRTC を張る試作版です。

- video: WebRTC media track
- telemetry / command / ack: RTCDataChannel
- pairing: room name + password
- camera / sensor permission: スマホ側 HTTPS 前提

## ディレクトリ

- `frontend/` Firestore signaling + WebRTC UI
- `pc_agent/` PC ローカル処理骨格
- `docs/` 設計メモ
- `examples/` メッセージ例

## frontend セットアップ

1. Firebase で Web App と Firestore Database を作成
2. repo 直下の `.env.example` をコピーして `.env.local` を作成
3. Firebase Web App の設定値を `VITE_FIREBASE_*` に貼る
4. `frontend/` でインストールと起動

```bash
cd frontend
npm install
npm run dev
```

## デプロイ

Netlify / Vercel などの静的ホスティングを想定しています。

- Base directory: `frontend`
- Build command: `npm run build`
- Publish directory: `dist`

`.env.local` の代わりに、ホスティング側の環境変数へ `VITE_FIREBASE_*` を設定してください。

## 使い方

### PC Host

1. `PC Host` を開く
2. `Room name` と `Password` を決める
3. `Create / Reset Room` を押す
4. 待機する

### Mobile Sensor

1. `Mobile Sensor` を開く
2. 同じ `Room name` と `Password` を入れる
3. `Start Camera` を押す
4. `Join Room` を押す
5. `Start Telemetry` を押す

## Firestore ルール

試作段階では `rooms` コレクションだけ読み書きできる緩いルールで十分です。`docs/firebase_setup.md` にサンプルを置いています。

## 注意

- password はクライアント側で SHA-256 にして room document に保存しています。デモ用途の軽いゲートであり、本格的な認証ではありません。
- iPhone / Safari はページ前面表示中の方が telemetry が安定します。
