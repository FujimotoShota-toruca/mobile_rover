# phone-web-telemetry-mvp-integrated

スマホと PC が同じ URL に入り、WebSocket でセンサ/コマンドをやり取りし、WebRTC でカメラ映像を渡すためのオンライン前提 MVP です。

## この版で追加したもの

- 参照 UI に寄せた 2 カラムダッシュボード
- PC 側の受信映像パネルと回転ボタン
- PC 側の方向ボタン、キーボード操作、コマンドログ
- PC 側の充電管理パネル
- センサ履歴の簡易ラインチャート
- 接続中 mobile device の自動一覧表示
- WebRTC signaling を既存 WebSocket に統合
- Pico W 用 HTTP bridge API
- 今後の vision / sensor_fusion 制御拡張用インタフェース枠
- Netlify / Render 向けの配備設定ファイル

## 構成

- `frontend/`
  - React + Vite + TypeScript
  - `mobile_sender`: センサ送信、ローカルカメラ、WebRTC offer 生成
  - `pc_viewer`: ダッシュボード、WebRTC answer、Pico W bridge 操作
- `backend/`
  - FastAPI
  - WebSocket session hub
  - セッション状態管理
  - Pico W HTTP bridge API
- ルート直下
  - `netlify.toml`: frontend 配備設定
  - `render.yaml`: backend 配備設定
  - `.env.example`: 本番環境変数の例

## ローカル実行

### backend

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
pytest -q
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### frontend

```powershell
cd frontend
npm install
npm run dev -- --host 0.0.0.0
```

## ローカル動作確認

### PC 側

- Session ID: `lab-demo-001`
- Device ID: `pc-001`
- Role: `pc_viewer`

### スマホ側

- Session ID: `lab-demo-001`
- Device ID: `mobile-001`
- Role: `mobile_sender`

## 本番配備の要点

### frontend 側

Netlify か Vercel に `frontend/` を配備します。  
このリポジトリには `netlify.toml` が入っているので、Netlify ではそのまま読み込めます。

設定する環境変数:

```text
VITE_API_BASE=https://your-api.onrender.com
VITE_WS_BASE=wss://your-api.onrender.com
```

`VITE_API_BASE` は REST 用、`VITE_WS_BASE` は WebSocket signaling / sensor / command 用です。

### backend 側

Render か Railway に `backend/` を Web Service として配備します。  
このリポジトリには `render.yaml`、`backend/Procfile`、`backend/runtime.txt` を入れてあります。

推奨環境変数:

```text
CORS_ALLOW_ORIGINS=https://your-site.netlify.app,https://your-custom-domain.example,http://localhost:5173
CORS_ALLOW_ORIGIN_REGEX=^https://.*$
```

### Render での最小手順

1. GitHub に push
2. Render で New + Web Service
3. リポジトリを接続
4. `render.yaml` を使うか、手動で次を設定
   - Root Directory: `backend`
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
5. デプロイ後、`/health` が返ることを確認

### Netlify での最小手順

1. GitHub に push
2. Netlify で Add new site + Import an existing project
3. リポジトリを接続
4. `netlify.toml` を読み込ませる
5. Site configuration の Environment variables に `VITE_API_BASE` と `VITE_WS_BASE` を設定
6. 再デプロイ

## HTTPS / 権限まわり

- iPhone のセンサ取得は secure context が必要です。
- iPhone のカメラ取得も secure context が必要です。
- そのため、実機検証は `https://...` 上で行う前提です。
- HTTPS の frontend から backend に接続する場合、WebSocket は `wss://...` を使ってください。

## Pico W bridge API

ブラウザから直接 `http://PicoIP/...` にアクセスさせるのではなく、backend が proxy します。  
これはオンライン配備時の mixed-content / CORS 回避を意識した構成です。

- `POST /api/vehicle/ping`
- `POST /api/vehicle/move`
- `POST /api/vehicle/battery/status`
- `POST /api/vehicle/battery/action/{start|stop|monitor}`
- `POST /api/vehicle/battery/set`

## 注意

- `.venv` は配布物に含めない運用が前提です。Windows 側では再生成してください。
- WebRTC は 1 mobile_sender ↔ 1 pc_viewer を主対象にした MVP 実装です。
- 本番運用では CORS を Netlify ドメインや独自ドメインに絞る方が安全です。
