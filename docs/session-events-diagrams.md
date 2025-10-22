# セッション通知 / 終了イベントの図解

Rdpstste で扱う `session_notify` (ログオン / リモート接続) と `session_end_event` (切断 / ログオフ) がどのように連携するかを、配置図とシーケンス図で整理しました。GitHub が Mermaid をサポートしているため、そのままスクロールするだけで図を表示できます。

## サマリー

- 定期的なハートビートではなく、イベント駆動でセッションの開始と終了を記録する構成に更新しました。
- 図の元データを Mermaid のソースファイルとして `docs/diagrams/` 以下に保存し、再利用しやすい形にしました。
- 新しい図を本文に埋め込み、ドキュメントを読むだけでイベントの流れを把握できるようにしました。

## 配置図 (Deployment Diagram)

```mermaid
graph LR
    subgraph MonitoredEndpoint["監視対象端末\n(Windows クライアント)"]
        TaskScheduler["タスク スケジューラ"]
        Notify["session_notify\n(.ps1 / .bat)"]
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

    TaskScheduler -- "ログオン / 接続検知時" --> Notify
    TaskScheduler -- "ログオフ / 切断検知時" --> SessionEnd
    Notify -- "POST /api/sessions/auto-heartbeat" --> API
    SessionEnd -- "POST /api/sessions/end" --> API
    Browser -- "PUT /api/sessions/{id}\n(status=disconnected)" --> API
    Browser -- "GET /api/sessions" --> API
    API -- "イベントを保存" --> Store
    API -- "一覧データ" --> Dashboard
    Dashboard -- "HTML/JS 配信" --> Browser
    API -- "接続/終了通知" --> Slack
    API -- "最新セッション情報" --> Notify
    API -- "更新結果" --> Browser
```

Mermaid 記法のソースは [`docs/diagrams/session-events-deployment.mmd`](./diagrams/session-events-deployment.mmd) に保存しています。図内で参照しているスクリプトやエンドポイントは、監視対象端末で動かす `scripts/endpoint/` ディレクトリの PowerShell / バッチ ファイルと、セットアップ用途の `scripts/setup/` 以下に用意した補助ツール、そして [`server.js`](../server.js) の REST API 実装に対応しています。`session_notify` はログオンまたはリモートセッション確立のイベントから実行し、`session_end_event` はログオフやセッション切断の直後に呼び出して終了タイムスタンプを記録します。

## シーケンス図 (Sequence Diagram)

```mermaid
sequenceDiagram
    participant Client as 監視対象端末
    participant NotifyAgent as session_notify(.ps1/.bat)
    participant EndAgent as session_end_event(.ps1/.bat)
    participant Api as Rdpstste REST API
    participant Store as sessions.json ストア
    participant Operator as 管理者
    participant Browser as Web ブラウザ
    participant Slack as Slack Webhook(任意)

    rect rgb(250,245,232)
        note over NotifyAgent,Api: セッション通知イベント
        Client->>NotifyAgent: ログオン / リモート接続検知
        NotifyAgent->>Api: POST /api/sessions/auto-heartbeat<br/>session.notify ペイロード送信
        Api->>Store: セッションを作成 or 更新 (status=connected)
        Api-->>NotifyAgent: 200 OK (セッション情報)
        Api-->>Slack: 接続通知 (任意)
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

シーケンス図の元データは [`docs/diagrams/session-events-sequence.mmd`](./diagrams/session-events-sequence.mmd) です。`session_notify` はログオンやリモート接続を検知したタイミングでセッション情報をサーバーへ送り、`session_end_event` が終了ログを確実に記録することで、セッションのライフサイクルをイベントだけで追跡できます。手動ステータス変更はバックアップ手段として残し、イベントが届かない場合の補正に活用します。

## 状態遷移図 (State Diagram)

イベント駆動型では「接続中」と「切断済み」をシンプルに扱い、通知から終了までを一意に追跡します。

```mermaid
%%{init: {'flowchart': {'curve': 'basis'}} }%%
stateDiagram-v2
    direction LR

    [*] --> Disconnected

    Disconnected --> Connected: session_notify\nPOST /api/sessions/auto-heartbeat

    Connected --> Disconnected: session_end_event\nPOST /api/sessions/end
    Connected --> Disconnected: 管理者操作\nPUT /api/sessions/{id} status=disconnected
```

状態遷移図のソースは [`docs/diagrams/session-state-machine.mmd`](./diagrams/session-state-machine.mmd) に保存しています。イベントが届いたタイミングで状態が遷移するため、定期的なハートビートを待たなくてもログオン直後の状況やログオフ直後の切断がダッシュボードへ即時反映されます。
