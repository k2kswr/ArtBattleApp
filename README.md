# おえかきバトル

`npm install` の後、`npm run dev` で起動します。投票モードはOpenAIキーなしで試せます。

## 本番設定

1. Supabaseで `supabase/schema.sql` を実行し、Storageバケット `artworks` を作成します。
2. `.env.example` を参照してVercel/Supabaseの環境変数を設定します。
3. AI採点を使う場合だけ `OPENAI_API_KEY` を追加します。キーはブラウザに公開しません。

環境変数未設定時は、同じブラウザ内で遊べるローカル保存モードになります。設定後はゲーム状態をSupabaseへ保存し、招待URLを開いた端末が約2.5秒ごとに状態を同期します。
