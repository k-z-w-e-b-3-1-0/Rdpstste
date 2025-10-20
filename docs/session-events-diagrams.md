# 接続・切断・ハートビート イベントの図解

Rdpstste で扱う接続・切断・ハートビートの 3 種類のイベントがどのように連携するかを、配置図とシーケンス図で整理しました。GitHub が Mermaid をサポートしているため、そのままスクロールするだけで図を表示できます。

## サマリー

- 接続時・定期的なハートビート送信・手動切断の三つのイベントを対象にした配置図を追加しました。
- 図の元データを Mermaid のソースファイルとして `docs/diagrams/` 以下に保存し、再利用しやすい形にしました。
- 新しい図を本文に埋め込み、ドキュメントを読むだけでイベントの流れを把握できるようにしました。

## 配置図 (Deployment Diagram)

```mermaid
graph LR
    subgraph MonitoredEndpoint["監視対象端末\n(Windows クライアント)"]
        TaskScheduler["タスク スケジューラ"]
        AutoHeartbeat["session_notify\n(.ps1 / .bat)"]
        ManualHeartbeat["session_heartbeat_event\n(.ps1 / .bat)"]
    end

    subgraph OperatorDevice["オペレーター端末"]
        Browser["Web ブラウザ\n(ダッシュボード)"]
    end

    subgraph MonitoringServer["Rdpstste 監視サーバ"]
        API["REST API\n(server.js)"]
        Store["sessions.json ストア"]
        Dashboard["ダッシュボード UI\n(public/ 配信)"]
        Slack["Slack Webhook\n(任意)"]
    end

    TaskScheduler -- "接続時 / 定期トリガー" --> AutoHeartbeat
    AutoHeartbeat -- "POST /api/sessions/auto-heartbeat" --> API
    ManualHeartbeat -- "POST /api/sessions/{id}/heartbeat" --> API
    Browser -- "PUT /api/sessions/{id}\n(status=disconnected)" --> API
    Browser -- "GET /api/sessions" --> API
    API -- "状態更新" --> Store
    API -- "一覧データ" --> Dashboard
    Dashboard -- "HTML/JS 配信" --> Browser
    API -- "接続通知" --> Slack
    API -- "最新セッション情報" --> AutoHeartbeat
    API -- "更新結果" --> Browser
```

Mermaid 記法のソースは [`docs/diagrams/session-events-deployment.mmd`](./diagrams/session-events-deployment.mmd) に保存しています。図内で参照しているスクリプトやエンドポイントは、`scripts/` ディレクトリの PowerShell / バッチ ファイルと [`server.js`](../server.js) の REST API 実装に対応しています。

## シーケンス図 (Sequence Diagram)

```mermaid
sequenceDiagram
    participant Client as 監視対象端末
    participant Agent as session_notify(.ps1/.bat)
    participant Api as Rdpstste REST API
    participant Store as sessions.json ストア
    participant Operator as 管理者
    participant Browser as Web ブラウザ
    participant Slack as Slack Webhook(任意)

    rect rgb(232,245,255)
        note over Agent,Api: 接続イベント
        Client->>Agent: ログオン / 初回タスク起動
        Agent->>Api: POST /api/sessions/auto-heartbeat<br/>接続メタデータ送信
        Api->>Store: セッション登録 / status=connected
        Api-->>Agent: 200 OK (セッション情報)
        Api-->>Slack: 接続通知 (新規 or 状態遷移時)
    end

    rect rgb(240,255,240)
        note over Agent,Api: ハートビートイベント
        loop 5分毎
            Agent->>Api: POST /api/sessions/auto-heartbeat<br/>lastSeen・プロセス状態更新
            Api->>Store: lastSeen を更新
            Api-->>Agent: 200 OK
        end
    end

    rect rgb(255,244,240)
        note over Operator,Browser: 切断イベント
        Operator->>Browser: 「切断に変更」をクリック
        Browser->>Api: PUT /api/sessions/{id}<br/>status=disconnected
        Api->>Store: ステータスを更新
        Api-->>Browser: 200 OK (更新済セッション)
    end

    Note over Browser,Api: ダッシュボードは30秒ごとに<br/>GET /api/sessions で最新状態を取得
```

シーケンス図の元データは [`docs/diagrams/session-events-sequence.mmd`](./diagrams/session-events-sequence.mmd) です。接続イベントは `session_notify` の初回送信で新規作成または `connected` への遷移を引き起こし、ハートビートは同スクリプトの定期実行で `lastSeen` を更新します。切断イベントはダッシュボードでの手動操作 (PUT `/api/sessions/{id}`) や、別途自動化したスクリプトからのリクエストで状態を `disconnected` に変更する想定です。

