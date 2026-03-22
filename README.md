# mobile_rover local-first WebRTC v0

この版は、**クラウド常駐 backend を主経路から外し**、

- スマホ: 公開 HTTPS フロントを開く
- PC: ブラウザで同じフロントを開く
- 通信本流: WebRTC 直結
- PC ローカル処理: `pc_agent/` のインタフェースで受ける

という方針に切り替えるための最初の骨格です。

## v0 でできること

- backend なしでスマホ↔PC を **manual signaling** で WebRTC 接続
- スマホの `DeviceMotion / DeviceOrientation` を PC に送る
- スマホのカメラ映像を PC に送る
- PC から `ping` を送ってスマホが `ack` を返す
- PC 側に telemetry / event log / remote video を表示する
- 将来の PC ローカル処理用に `pc_agent/` のインタフェース骨格を用意

## v0 の割り切り

- signaling server はまだない
- session code / QR pairing もまだない
- PC local agent への自動ブリッジはまだない
- まずは **manual offer/answer で本流が成立するか** を確認する版

## ディレクトリ

- `frontend/`: 公開 HTTPS 向けの React/Vite フロント
- `pc_agent/`: PC ローカル処理の Python 骨格
- `docs/`: アーキテクチャ・手順
- `examples/`: JSON サンプル

## フロント起動

```bash
cd frontend
npm install
npm run dev
```

本番配備時は Netlify / Vercel / GitHub Pages などを想定しています。

## manual pairing の流れ

1. PC で `PC Host` を開く
2. `Create Offer` を押す
3. 生成された offer JSON をスマホへ渡す
4. スマホで `Mobile Sensor` を開く
5. `Start Camera` が必要なら押す
6. PC から受け取った offer JSON を貼り付ける
7. `Accept Offer / Create Answer` を押す
8. answer JSON を PC へ返す
9. PC で answer JSON を貼り付けて `Apply Answer` を押す
10. connected になったら、スマホで `Start Telemetry` を押す

## PC local agent について

`pc_agent/` は、今後 WebRTC 受信結果をローカル保存・画像処理・制御出力に流すための骨格です。
この v0 ではまだ frontend から自動接続していません。

優先実装順は次です。

1. browser-browser で telemetry / video / ping-ack が通ることを確認
2. PC 側 browser 受信結果を local file に保存
3. `pc_agent` に message bridge を追加
4. 必要なら tiny signaling relay を追加

