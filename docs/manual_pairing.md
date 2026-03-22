# manual pairing v1

## 成功しやすい順番

1. PC Host で `Create Offer`
   - v1 では video recvonly transceiver が自動で追加される
2. Offer JSON を Mobile Sensor に貼る
3. Mobile Sensor で `Start Camera`
4. `Accept Offer / Create Answer`
5. Answer JSON を PC Host に戻す
6. PC Host で `Apply Answer`
7. `dc: open` と `video: track / playing` を見る
8. Mobile Sensor で `Start Telemetry`
9. PC Host で telemetry count が増えることを確認
10. PC Host で `Send Ping`
11. latest ack を確認

## 失敗しやすいパターン

- camera を起動する前に Answer を作る
- DataChannel が open する前に Send Ping を押す
- HTTPS でなく iPhone 権限が denied になる
- Safari を背面に回して telemetry の安定性が落ちる
