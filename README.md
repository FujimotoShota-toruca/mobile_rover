# mobile_rover local-first WebRTC v1

公開HTTPSフロントをスマホ/PCで開き、manual signaling で WebRTC を直結するローカルファースト試作版です。

## 今回の v1 で狙うこと

- iPhone Safari で DeviceMotion / DeviceOrientation の権限を取る
- WebRTC DataChannel で telemetry / ping / ack を流す
- WebRTC video track でスマホ映像を PC に表示する
- 常駐 backend を本流から外し、PC を処理主体にする

## UI の考え方

- `PC Host`
  - Offer 作成
  - Answer 適用
  - telemetry 受信表示
  - latest ack 表示
  - remote video 表示
  - video rotation
- `Mobile Sensor`
  - Camera 起動
  - Offer 適用 / Answer 作成
  - telemetry 送信
  - command 受信 / ack 返送
  - local camera preview

## 重要な注意

remote video を受けるには、PC 側 Offer に video m-line が必要です。
v1 では `PC Host` の `Create Offer` 実行時に `video recvonly transceiver` を自動追加しています。

また、Mobile 側は **Start Camera を先に押してから** `Accept Offer / Create Answer` を実行してください。
これにより、video track が Answer に乗ります。

## 使い方

### ローカル開発

```bash
cd frontend
npm install
npm run dev
```

### HTTPS 配信

iPhone Safari で telemetry permission を通すには、HTTPS 配信が前提です。
Netlify などに `frontend/` を静的デプロイして利用してください。

## manual pairing 手順

1. PC で `PC Host` を開く
2. `Create Offer`
3. 表示された Offer JSON をスマホへコピー
4. スマホで `Mobile Sensor` を開く
5. `Start Camera`
6. Offer JSON を貼る
7. `Accept Offer / Create Answer`
8. 生成された Answer JSON を PC へ戻す
9. PC で `Apply Answer`
10. `dc: open` と `pc.connection: connected` を確認
11. スマホで `Start Telemetry`
12. PC で telemetry 更新を確認
13. PC で `Send Ping`
14. latest ack を確認

## 今後の拡張

- tiny signaling relay
- QR pairing
- pc_agent 自動ブリッジ
- OpenCV / vision hook
- vehicle bridge
