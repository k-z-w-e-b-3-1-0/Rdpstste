# Rdpstste

ネットワーク上の端末がリモートデスクトップでアクセスされているかを把握するためのシンプルな監視ダッシュボードです。Node.js の標準モジュールのみで構成されており、RDP 接続状況を REST API を通じて登録・更新できます。

## 機能概要

- 接続中 / 切断状態の端末を一覧表示
- 接続数サマリーカードで全体の把握が可能
- 新規端末の登録、状態の更新、削除に対応
- 端末からの定期ハートビートで最終確認時刻を自動更新
- API を利用した外部スクリプト連携が可能
- 監視対象に指定したプロセスの起動有無を可視化
- リモート接続元端末やアクセス元 IP、ユーザー情報を記録して可視化
- リモートデスクトップで端末が遠隔操作されているかを自動判定して表示
- 接続検知時に Slack へ通知を送信
- ダッシュボードからのボタン操作で利用予定を Slack に共有

## 必要要件

- Node.js 18 以上

## セットアップと起動

```bash
npm install # 追加の依存は不要ですが、lock ファイル更新のために実行してください
npm start
```

サーバーは既定で `http://localhost:3000` で待ち受けます。環境変数 `PORT` を設定するとポート番号を変更できます。

## API

| メソッド | エンドポイント | 説明 |
| --- | --- | --- |
| `GET` | `/api/sessions` | 登録済み端末を取得 |
| `POST` | `/api/sessions` | 端末を新規登録。`hostname` と `ipAddress` は必須 |
| `GET` / `POST` | `/api/sessions/auto-heartbeat` | リモート端末からのアクセスのみで IP 情報を基にセッションを自動作成・更新 |
| `PUT` | `/api/sessions/{id}` | 端末情報や状態の更新 |
| `DELETE` | `/api/sessions/{id}` | 端末を削除 |
| `POST` | `/api/sessions/{id}/heartbeat` | 端末の最終確認時刻を現在時刻に更新し接続中として扱う |
| `POST` | `/api/sessions/{id}/announce` | 指定端末の利用予定を Slack に通知 |

### フィールドの補足

- `expectedProcesses`: 監視したいプロセス名の配列またはカンマ区切り文字列。ダッシュボードに「監視対象」として表示され、未起動の場合はアラート扱いになります。
- `processStatuses`: `[{ "name": "mstsc.exe", "running": true }]` のような形式で、プロセスごとの稼働状況を明示的に送信したい場合に利用します。`lastChecked` はサーバー側で自動付与されます。
- `runningProcesses` / `processes`: 自動ハートビート用の簡易指定。カンマ区切りまたは配列で現在起動中のプロセス名を送信すると、監視対象リストと突き合わせて稼働状況を判定します。
- `remoteHost`: リモートデスクトップの接続元端末名や IP を記録する文字列。
- `remoteHostIpAddress`: リモートデスクトップの接続元 IP アドレスを記録する文字列。
- `remoteUser`: 接続してきたリモートユーザー名を記録する文字列 (例: `corp\\administrator`)。
- `remoteControlled`: 端末がリモートデスクトップで操作されていると検知した場合は `true` を送ります。未判定やローカル操作のみの場合は省略するか `null` を指定してください。
- `sessionName`: Windows の `SESSIONNAME` 環境変数など、セッション名を文字列で送ると `RDP-Tcp#` などの値から遠隔操作を自動判定します。

### 例: 端末の登録

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "hostname": "PC-01",
    "ipAddress": "192.168.0.10",
    "username": "tanaka",
    "remoteUser": "corp\\administrator",
    "remoteHost": "192.168.100.50",
    "remoteHostIpAddress": "198.51.100.23"
  }'
```

### 例: ハートビート送信

```bash
curl -X POST http://localhost:3000/api/sessions/<id>/heartbeat
```

### 例: セッション ID の確認と指定

セッション ID は UUID 形式で発行され、`GET /api/sessions` のレスポンスから取得できます。以下は `data/sessions.sample.json` の例に含まれる ID を使った操作イメージです。

```bash
# セッション一覧を取得し、ID を確認
curl http://localhost:3000/api/sessions

# 取得した ID を利用して利用予定通知を送信
curl -X POST \
  http://localhost:3000/api/sessions/a3c1e8f2-1234-4bcd-9f11-222233334444/announce

# 同じ ID に対してメモを更新
curl -X PUT \
  http://localhost:3000/api/sessions/a3c1e8f2-1234-4bcd-9f11-222233334444 \
  -H "Content-Type: application/json" \
  -d '{"notes":"15時からメンテナンス予定"}'
```

### 例: リモート端末からの自動ハートビート

監視される端末側には追加インストールを求めない設計です。Windows 標準の PowerShell だけでハートビートを送信し、同時に監視対象プロセスの起動状況も報告できます。

```powershell
$server = "http://監視サーバーのアドレス:3000"
$targetProcesses = "mstsc.exe","custom-tool.exe"

$running = Get-Process |
  Where-Object { $targetProcesses -contains ($_.ProcessName + ".exe") } |
  Select-Object -ExpandProperty ProcessName
$runningList = ($running | ForEach-Object { $_ + ".exe" }) -join ","

$remoteHost = if ($env:CLIENTNAME) { $env:CLIENTNAME } else { $null }
$sessionName = if ($env:SESSIONNAME) { $env:SESSIONNAME } else { $null }
$isRemoteSession = if ($sessionName -and $sessionName -like 'RDP-Tcp*') { $true } else { $false }
$remoteControlled = if ($isRemoteSession) { $true } else { $null }

$payload = @{
  hostname = $env:COMPUTERNAME
  username = $env:USERNAME
  remoteUser = $env:USERNAME
  remoteHost = $remoteHost
  sessionName = $sessionName
  remoteControlled = $remoteControlled
  expectedProcesses = ($targetProcesses -join ",")
  runningProcesses = $runningList
}

Invoke-WebRequest -UseBasicParsing \
  -Uri "${server}/api/sessions/auto-heartbeat" \
  -Method Post \
  -ContentType "application/json" \
  -Body ($payload | ConvertTo-Json)
```

サーバー側ではアクセス元 IP を自動検出し、セッションが未登録なら作成、既存なら最終確認時刻とプロセス状態を更新します。タスクスケジューラで数分おきに実行すれば、監視対象側に常駐アプリを導入することなくリモートアクセス状況とプロセス稼働を同時に把握できます。

### Slack 通知

環境変数 `SLACK_WEBHOOK_URL` に Incoming Webhook の URL を設定すると、以下のタイミングで Slack に通知が送信されます。

- セッションが新規登録されたとき (自動・手動いずれも)
- セッションの状態が「接続中」に遷移したとき
- 接続中のセッションでリモートユーザーまたは接続元ホストが更新されたとき
- ダッシュボードの「利用予定を通知」ボタンが押されたとき

通知には端末名、IP アドレス、ローカルユーザー、リモートユーザー、接続元ホスト、備考が含まれます。Slack 通知を無効化したい場合は環境変数を設定しなければ何も送信されません。Slack Webhook を設定していない状態で通知ボタンを押した場合は、ダッシュボードに警告が表示されるだけで実際の通知は送信されません。

## データ保存

セッション情報は `data/sessions.json` に保存されます。Git では追跡していませんが、サーバー起動時に自動生成されます。サンプル構造を確認したい場合は、リポジトリに含まれている `data/sessions.sample.json` を参照してください。

## ライセンス

MIT License
