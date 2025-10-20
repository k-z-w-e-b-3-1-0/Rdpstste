# 接続・切断・ハートビート イベントの図解

Rdpstste で扱う接続・切断・ハートビート、そしてセッション開始・終了イベントがどのように連携するかを、配置図とシーケンス図で整理しました。GitHub が Mermaid をサポートしているため、そのままスクロールするだけで図を表示できます。

## サマリー

- 接続時・定期的なハートビート送信・手動切断に加えて、`session_start_event` / `session_end_event` で収集する開始・終了イベントを図に追加しました。
- 図の元データを Mermaid のソースファイルとして `docs/diagrams/` 以下に保存し、再利用しやすい形にしました。
- 新しい図を本文に埋め込み、ドキュメントを読むだけでイベントの流れを把握できるようにしました。

## 配置図 (Deployment Diagram)

```mermaid
graph LR
    subgraph MonitoredEndpoint["監視対象端末\n(Windows クライアント)"]
        TaskScheduler["タスク スケジューラ"]
        SessionStart["session_start_event\n(.ps1 / .bat)"]
        AutoHeartbeat["session_notify\n(.ps1 / .bat)"]
        ManualHeartbeat["session_heartbeat_event\n(.ps1 / .bat)"]
        SessionEnd["session_end_event\n(.ps1 / .bat)"]
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

    TaskScheduler -- "接続確立直後" --> SessionStart
    TaskScheduler -- "接続時 / 定期トリガー" --> AutoHeartbeat
    TaskScheduler -- "切断検知時" --> SessionEnd
    AutoHeartbeat -- "POST /api/sessions/auto-heartbeat" --> API
    ManualHeartbeat -- "POST /api/sessions/{id}/heartbeat" --> API
    SessionStart -- "POST /api/sessions/start" --> API
    SessionEnd -- "POST /api/sessions/end" --> API
    Browser -- "PUT /api/sessions/{id}\n(status=disconnected)" --> API
    Browser -- "GET /api/sessions" --> API
    API -- "開始/終了イベントを追記" --> Store
    API -- "状態更新" --> Store
    API -- "一覧データ" --> Dashboard
    Dashboard -- "HTML/JS 配信" --> Browser
    API -- "接続/開始/終了通知" --> Slack
    API -- "最新セッション情報" --> AutoHeartbeat
    API -- "更新結果" --> Browser
```

Mermaid 記法のソースは [`docs/diagrams/session-events-deployment.mmd`](./diagrams/session-events-deployment.mmd) に保存しています。図内で参照しているスクリプトやエンドポイントは、`scripts/` ディレクトリの PowerShell / バッチ ファイルと [`server.js`](../server.js) の REST API 実装に対応しています。`session_start_event` と `session_end_event` は、タスク スケジューラなどで接続直後・切断直後に実行し、サーバー側で開始・終了タイムスタンプを記録する想定です。

## シーケンス図 (Sequence Diagram)

```mermaid
sequenceDiagram
    participant Client as 監視対象端末
    participant StartAgent as session_start_event(.ps1/.bat)
    participant Agent as session_notify(.ps1/.bat)
    participant Manual as session_heartbeat_event(.ps1/.bat)
    participant EndAgent as session_end_event(.ps1/.bat)
    participant Api as Rdpstste REST API
    participant Store as sessions.json ストア
    participant Operator as 管理者
    participant Browser as Web ブラウザ
    participant Slack as Slack Webhook(任意)

    rect rgb(250,245,232)
        note over StartAgent,Api: セッション開始イベント
        Client->>StartAgent: 認証完了 / ログオン直後
        StartAgent->>Api: POST /api/sessions/start<br/>session.start ペイロード送信
        Api->>Store: 開始ログを追記 / startedAt 更新
        Api-->>StartAgent: 202 Accepted (イベント受領)
        Api-->>Slack: 開始通知 (任意)
    end

    rect rgb(232,245,255)
        note over Agent,Api: 接続状態更新 / ハートビート
        Client->>Agent: タスクスケジューラで数分おきに実行
        Agent->>Api: POST /api/sessions/auto-heartbeat<br/>接続メタデータ・lastSeen を送信
        Api->>Store: セッション登録 or status=connected 更新
        Api-->>Agent: 200 OK (セッション情報)
        Api-->>Slack: 接続通知 (新規 or 状態変化)
        loop 任意のタイミング
            Manual->>Api: POST /api/sessions/{id}/heartbeat<br/>session.heartbeat イベント送信
            Api->>Store: lastSeen・idle 情報を更新
            Api-->>Manual: 200 OK
        end
    end

    rect rgb(255,244,240)
        note over Operator,Browser: 手動ステータス更新
        Operator->>Browser: 「切断に変更」をクリック
        Browser->>Api: PUT /api/sessions/{id}<br/>status=disconnected
        Api->>Store: ステータスを更新
        Api-->>Browser: 200 OK (更新済セッション)
    end

    rect rgb(255,240,240)
        note over EndAgent,Api: セッション終了イベント
        Client->>EndAgent: ログオフ / セッション切断トリガー
        EndAgent->>Api: POST /api/sessions/end<br/>session.end ペイロード送信
        Api->>Store: 終了ログを追記 / status=disconnected
        Api-->>EndAgent: 200 OK
        Api-->>Slack: 終了通知 (任意)
    end

    Note over Browser,Api: ダッシュボードは30秒ごとに<br/>GET /api/sessions で最新状態を取得
```

シーケンス図の元データは [`docs/diagrams/session-events-sequence.mmd`](./diagrams/session-events-sequence.mmd) です。`session_start_event` は接続直後の開始イベントを記録し、`session_notify` の自動ハートビートや `session_heartbeat_event` の詳細なアイドル情報と組み合わせることで、セッション開始〜継続〜終了のライフサイクルを追跡できます。切断時には `session_end_event` が終了ログと稼働指標 (任意) を送信し、ダッシュボードや Slack 通知に反映されます。
