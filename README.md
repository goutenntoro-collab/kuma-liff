# liff/test.html — LIFF疎通検証（捨てページ）

音声・マイク・LIFFプロフィール取得がLINEアプリ内ブラウザで実際に動くかを確認するための、使い捨ての検証ページ。

## 使い方

1. `liff/` フォルダをGitHub Pagesなどで公開する（ディレクトリ単位で公開すること）。
2. LINE Developersコンソールで、既存Messaging APIチャネルと**同じプロバイダー**の下にLINE Loginチャネルを作り、LIFFアプリ（サイズ`Full`、Scope `profile`+`openid`）を追加する。
3. 発行されたLIFF IDを `test.html` 先頭の `const LIFF_ID = "";` に書いて再pushする。
4. LINEのトーク画面から `https://liff.line.me/{LIFF_ID}/test.html` を開く。
5. ①〜⑥のボタンを順番に押し、画面に出る結果（成功/失敗/エラー名）を確認する。
6. iPhoneとAndroidの両方で試し、②で得た `userId` が既存のLINE Webhook経由の `userId` と一致するか突き合わせる。

## 検証結果の記録先

結果は `docs/06_VOICE_CHECK.md` に記録する。userIdが一致しない場合はTASK-009に進まないこと。

---

# liff/index.html — くまちゃん会話ページ（本番）

LINEのトーク画面から開く、くまちゃんとの会話ページ。文字入力が主、音声は対応環境でのみ使える。
返答は GASウェブアプリ（`doPost` に追加した `liff_message` 分岐）から取得する。

## 設定手順

1. `liff/app.js` 先頭の2つの定数を書き換える。
   - `LIFF_ID`: LINE Developersコンソールで発行されたLIFFアプリのID
   - `GAS_URL`: GASウェブアプリのURL（後述の手順で発行される `https://script.google.com/macros/s/.../exec` 形式のURL）
2. GASエディタで対象プロジェクトを開き、「デプロイ」→「新しいデプロイ」→種類「ウェブアプリ」を選び、「アクセスできるユーザー」を「全員」にしてデプロイする。発行されたURLを `GAS_URL` に設定する。`Config.LIFF_ENABLED` が `true` であること、`Config.LIFF_CHANNEL_ID` にLINE LoginチャネルのチャネルIDが設定されていることを確認する。
3. `liff/assets/` に `kuma_idle.png` / `kuma_listen.png` / `kuma_think.png` / `kuma_talk.png` を配置する（無くてもページは壊れず、名前だけ表示される）。
4. GitHub Pagesなどに `liff/` をpushして公開し、LINEのトーク画面から `https://liff.line.me/{LIFF_ID}` を開いて動作確認する。
