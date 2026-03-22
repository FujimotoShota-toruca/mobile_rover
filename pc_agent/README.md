# pc_agent

PC ローカルで動かす処理系の骨格です。

この v0 ではまだ frontend と自動接続していません。まず browser-browser WebRTC を成立させ、その後に browser -> local agent bridge を追加する前提です。

## 役割

- telemetry の保存
- vision の入力点
- control engine の入力点
- vehicle bridge の出力点

## 起動例

```bash
cd pc_agent
python -m venv .venv
source .venv/bin/activate  # Windows は Scripts 側
pip install -r requirements.txt
python -m agent.mock_runner
```

