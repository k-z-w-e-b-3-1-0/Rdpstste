# ハートビート監視構成の図解プレビュー

サーバ 1 台と監視対象 2 台が 5 分おきにハートビートを送信する構成の UML 図を画像としてプレビューできるよう、Mermaid のホスティングサービスを利用したリンク付き Markdown を用意しました。

## 配置図 (Deployment Diagram)

![ハートビート監視の配置図](https://mermaid.ink/img/pako:Sy9KLMhQ8AniUgCC4tKkdDDfNz8vsyS_KDMvPT44tagstSha6fnsxS-WTXvctPVx857HzRNi8jT8gxW0FTxSE4tKklITSxSc83NyUpOBujSVYsGmgQBcMFoJi0oFkOGZyalIGoKBwqlA27q2PWvtfty083Fzx-OmRUDbHjcvfNy86HHzKgWgPhcnmCWpeSlcWN2emhLvl5-SGu8Ic_rT9ftebASa0Qf2QKeCI6YXHNNT80qQnQ8WcER2O1gEWUVBAVAe6MTHzdOBjnvctBFkfNP2x83LHzdvdiTWlU64XOlErCudCLjSCbcrndBdCfG2gq6ugpLp0462x41djxt7Hzeue9zcD3ZWx-PmyRAG0HUeISEBGsGa-ulBAc4Kz9d2aioBNdohIhlhohM1TUQkIpChkPTybPaWZ9M2PG7e_Xzqhqc7djxbMuf5_KUQzeB0xQUA)

Mermaid 記法のソースは [`docs/diagrams/heartbeat-deployment.mmd`](./diagrams/heartbeat-deployment.mmd) に保存してあります。

## シーケンス図 (Sequence Diagram)

![ハートビート監視のシーケンス図](https://mermaid.ink/img/pako:tVFBSwJBGL3vr_iOehBPXTws7NohKLr4CyYdRNh2bd3uuYOypKVQVNRBrSCFNIsIK8MfM86o_6Jxx5ZMJQj6YJiZx3vve99MDu_tYzOJ1zMobaNdBURlke1kkpksMh3Q0th0NEA52MAC3sFohkFo20ph0MLLJfpqib4oiVuGgZOOZc-rAnhBkBAgnpJHhy-8UKLuKyUeda-jYlHSoqQv7rxV43clxRcblpWFNeYV-cOxD0xLDhdR1aBRDCipSDUlJ_IwOcgPBw0IjZp9Ro5mDck7JQ3qDjgpsPpjOLAMnCLCVvrHQItvQhRY5Vz4sE55-FZcwldVf6gYyHcFmu_IXvzqmZ91lfnU-j-n1v-UWl-dGhnOkpT8vj6ufjDvlnUuA-qKDt-_dnRa415VxEtsaTBuXkzKT4EcGzkMvH3Dej05_G_GkktJm7rdn15mSvnaPwE=)

Mermaid 記法のソースは [`docs/diagrams/heartbeat-sequence.mmd`](./diagrams/heartbeat-sequence.mmd) です。

---

> **補足**: 社内ネットワークやオフライン環境で閲覧する場合は、`docs/diagrams/*.mmd` を元に `@mermaid-js/mermaid-cli` などでローカル生成した画像ファイルに差し替えてください。
