# Smartphone RC Car / WebRTC + BLE Bridge Scaffold

この一式は、以下の構成を前提にした最小実装スキャフォールドです。

- 機体搭載スマホ: カメラ/GPS/IMU/WebRTC/BLE ブリッジ
- 操縦側 PC: 同じ Web アプリで接続し、手動操縦または localhost 自律制御サーバ利用
- Pico W: BLE peripheral としてモータ制御・フェイルセーフ担当
- Firestore: WebRTC シグナリングのみ

## フォルダ構成

- `web/`
  - Netlify などの静的ホスティングでそのまま配信できるフロントエンド
- `pico/`
  - Arduino-Pico 用の Pico W BLE UART スケッチ
- `local_server/`
  - Python 製の localhost 自律制御サーバ

## 1. Web 側セットアップ

1. `web/src/firebase_config.js` を確認します。
   - 今回は、既存 HTML に埋め込まれていた Firebase 設定値を流用しています。
   - 自分の Firebase プロジェクトへ切り替える場合はこのファイルを書き換えてください。
2. `web/` を Netlify 等へデプロイします。
3. HTTPS で開けることを確認します。

## 2. 操作手順

### 機体側スマホ

1. `role = vehicle` を選択
2. `初期化` を押す
3. `BLE接続` を押して Pico W を選択
4. `セッション開始` を押す
5. 画面上に room ID が出ていれば、その ID を PC 側に入力

### PC 側

1. `role = controller` を選択
2. 同じ room ID を入力
3. `セッション開始` を押す
4. `W/A/S/D` または画面ボタンで操作
5. 自律制御したい場合は `local_server/server.py` を起動し、`自律WS接続` を押して `AUTO` を有効化

## 3. ローカル自律制御サーバ

```bash
cd local_server
python -m venv .venv
source .venv/bin/activate   # Windows は .venv\Scripts\activate
pip install -r requirements.txt
python server.py --target-lat 36.561 --target-lon 139.883
```

ブラウザ側では既定で `ws://127.0.0.1:8765/ws` へ接続します。

## 4. Pico W 側セットアップ

### Arduino IDE / Arduino-Pico 前提

- Board: Raspberry Pi Pico W
- `Tools -> IP/Bluetooth Stack` で Bluetooth を有効化

スケッチ:
- `pico/pico_rc_ble_uart_bridge.ino`

このスケッチは、Nordic UART 互換 BLE サービスを使ってテキスト行ベースの簡易プロトコルをやり取りします。

### 受信コマンド例

```text
PING
ESTOP
MODE MANUAL
DRIVE 100 350 -120 300 0
```

意味:
- `DRIVE <seq> <throttle[-1000..1000]> <steering[-1000..1000]> <ttl_ms> <estop>`

### 送信テレメトリ例

```text
PONG 12345
STAT 100 MANUAL 7420 0 120 -30 56789
```

意味:
- `STAT <ack_seq> <state> <battery_mv> <faults> <left_cmd> <right_cmd> <uptime_ms>`

## 5. 注意点

- これは動作の芯になる最小構成です。実機導入前に、必ずモータ未接続・車輪浮かせ状態で検証してください。
- Pico 側には通信断フェイルセーフを入れていますが、最終的には電源系ハードウェア E-STOP も推奨です。
- iPhone を使う場合は Safari ではなく Bluefy 想定です。
- TURN サーバはまだ組み込んでいません。別回線本番運用では `web/src/rtc_peer.js` の ICE サーバ設定を拡張してください。

## 6. 現時点で未実装/軽実装な点

- カメラ画像ベースの本格 CV 制御
- バッテリ電圧の厳密な実測回路依存処理
- 複数 room の認証/アクセス制御
- TURN 自動構成
- Pico 側パケットの固定長バイナリ化

まずはこれで、

PC → WebRTC DataChannel → 車載スマホ → BLE UART → Pico W

という制御経路と、

車載スマホ → WebRTC Video/Telemetry → PC

という観測経路を通すことを主目的にしています。
