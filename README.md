# おえかきバトル

友だちとリアルタイムで遊べる、制限時間付きのお絵描き対戦Webアプリです。お題に沿って絵を描き、AI採点または参加者投票で順位を競います。

**公開URL:** https://art-battle-app.vercel.app/

## 主な機能

- 5桁のルームIDで、1〜8人が別端末から参加
- 10 / 30 / 90 / 180秒、1 / 3 / 5 / 10ラウンドを選択可能
- 40種類の一単語お題を重複なしでランダム出題
- ペン・色・太さ・消しゴムを備えたCanvas描画
- Supabase Realtimeによる、相手の描画中プレビュー
- OpenAI Responses APIによる画像採点（点数・短評）
- API不要でも遊べる参加者投票モードと棄権機能
- 順位ポイント（5 / 3 / 1点）、最終ランキング、再戦

## 技術スタック

| 分類 | 技術 | 採用理由 |
| --- | --- | --- |
| フロントエンド | Next.js 16 / React 19 / TypeScript | UIとAPIを同一プロジェクトで型安全に開発できるため |
| 描画 | HTML Canvas API | ブラウザ標準で軽量な自由描画を実現できるため |
| リアルタイム通信・DB | Supabase Realtime / PostgreSQL | 描画同期とルーム状態の永続化を素早く構築できるため |
| AI | OpenAI Responses API | 画像を入力し、構造化JSONで採点結果を取得できるため |
| ホスティング | Vercel | Next.jsのデプロイと環境変数管理を簡単に行えるため |
| テスト | Vitest | TypeScriptのロジックを高速に検証できるため |

## 工夫した点

- **通信量を削減:** 描画中は線分イベントのみをRealtime配信し、完成画像は提出時だけ圧縮JPEGで保存。
- **同時提出に対応:** 提出専用APIで二重提出を防止し、状態のバージョンチェックとリトライで競合を抑制。
- **タイマーを同期:** 共通の開始・終了時刻から残り時間を算出し、端末ごとのカウントダウンずれを防止。
- **コストに配慮:** AIを使わない投票モードを用意し、APIキーや料金なしでも遊べる設計。

## システム構成

```text
Browser (Next.js / React)
  ├─ Serverless API (Vercel) ── Supabase PostgreSQL
  ├─ OpenAI Responses API（AI採点時のみ）
  └─ Supabase Realtime（描画ライブプレビュー）
```

## 動作確認

```bash
pnpm run build
pnpm test
```
