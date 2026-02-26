#!/bin/bash
# スクリプトのディレクトリに移動
cd "$(dirname "$0")"

# ブラウザをバックグラウンドで開く（サーバーが起動するのを少し待つ）
(sleep 1; open "http://localhost:8000") &

# Python 3 の簡易サーバーを起動
python3 -m http.server 8000

