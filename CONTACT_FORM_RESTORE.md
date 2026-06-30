# お問い合わせフォーム 復旧手順書

> **このファイルが必要になる場面**
> `contact.html` を **DesignCode で再生成すると、フォーム送信機能（reCAPTCHA + メール送信）が消えます**。
> 「送信する」ボタンを押しても何も起きなくなったら、この手順で復旧してください。
>
> 症状：送信ボタンを押しても無反応／メールが届かない
> 原因：再生成で `contact.html` が上書きされ、送信ロジックが `e.preventDefault()` だけのダミーに戻る

---

## なぜ消えるのか

`contact.html` のフォーム送信機能は、DesignCode では生成されない「**手書きで追記したコード**」です。
DesignCode で再生成すると、この手書き部分が出力に含まれず消えてしまいます。

デザイン（見た目・SP対応・ダークモード等）を DesignCode で更新すること自体は問題ありません。
**再生成のたびに、以下の4箇所を再追記すればフォームは復活します。**

---

## 復旧に使う値（公開してOK・コードに書いてよい）

| 項目 | 値 |
|---|---|
| reCAPTCHA Site Key | `6LctKjYtAAAAAH5QzIpfClD4qbeOD_cPwmOTxZrU` |
| GAS エンドポイント URL | `https://script.google.com/macros/s/AKfycbwCy_3lKWolOytX6lCT2B8ysWO1mJyzNRxT1n7EnAusOEdl1NbNc3Co7Uh_0gdnFpJn/exec` |

> ⚠️ **シークレット**（reCAPTCHA Secret / Microsoft の CLIENT_SECRET）は、ここには書きません。
> それらは **GAS のスクリプトプロパティ**に登録済みで、HTMLからは触りません。
> （GAS側の設定は `_partials/contact-form-gas.js` 冒頭のコメント参照）

> 📌 GASを「新しいデプロイ」で作り直すと URL が変わります。その場合は上表とコード中の
> `GAS_ENDPOINT` を新URLに差し替えてください。URLを変えたくない場合は GASで
> 「デプロイを管理 → 編集（鉛筆）→ バージョン:新バージョン」で更新します。

---

## 復旧手順（4箇所を追記）

### ① `<head>` に reCAPTCHA 読込とキー設定を追加

`<script src="./support.js"></script>` の**直後**（`</head>` の直前）に以下を追加：

```html
<!-- reCAPTCHA v3 / GAS endpoint（フォーム送信機能） -->
<script src="https://www.google.com/recaptcha/api.js?render=6LctKjYtAAAAAH5QzIpfClD4qbeOD_cPwmOTxZrU"></script>
<script>
  window.LIMACON_CONTACT = {
    RECAPTCHA_SITE_KEY: '6LctKjYtAAAAAH5QzIpfClD4qbeOD_cPwmOTxZrU',
    RECAPTCHA_ACTION:   'contact_submit',
    GAS_ENDPOINT:       'https://script.google.com/macros/s/AKfycbwCy_3lKWolOytX6lCT2B8ysWO1mJyzNRxT1n7EnAusOEdl1NbNc3Co7Uh_0gdnFpJn/exec'
  };
</script>
```

### ② フォーム各入力に `name` 属性を追加

DesignCode 生成版には `name` 属性が付きません。以下のように追記します：

| 要素 | 追記する属性 |
|---|---|
| 種別の `<select>` | `name="category"`（先頭optionは `<option value="">選択してください</option>`） |
| お名前の `<input type="text" placeholder="Your Name">` | `name="name"` |
| 会社名の `<input type="text" placeholder="Company">` | `name="company"` |
| メールの `<input type="email">` | `name="email"` |
| 電話の `<input type="tel">` | `name="tel"` |
| 内容の `<textarea>` | `name="message"` |
| 同意の `<input type="checkbox">` | `name="agree"` |

### ③ 送信ボタンの直前にステータス表示欄を追加 + ボタンに `data-submit`

送信ボタン `<button data-magnetic type="submit" ...>` を以下に置き換え（直前に status div を追加し、button に `data-submit` を付与）：

```html
<div data-form-status style="display:none;font-size:14px;line-height:1.8;font-weight:700;padding:14px 16px;border-radius:6px;text-align:center"></div>
<button data-submit data-magnetic type="submit" style="...（既存のstyleそのまま）...">送信する <span style="color:var(--gold,#c6a25e);font-size:18px">→</span></button>
```

### ④ 末尾 `<script type="text/x-dc">` 内の submit ハンドラを差し替え

再生成版には以下のダミーがあります（これが「送信が効かない」原因）：

```js
    const form = q('form');
    if (form) form.addEventListener('submit', (e) => { e.preventDefault(); });
```

これを、**動作している contact.html（このリポジトリの最新コミット）の同じ箇所**にある
本実装（`const cfg = window.LIMACON_CONTACT ...` から始まる約120行のブロック）に置き換えます。

> 💡 一番確実な方法：`git log` で直前の動作版コミットを探し、
> `git show <動作版コミット>:contact.html` から ① 〜 ④ の差分を見て同じ編集を再適用する。
> または、動作版の `contact.html` をベースに、DesignCode が変えたデザイン部分（背景色・
> ハンバーガーメニュー等）だけを移植する方が安全な場合もあります。

---

## 復旧後の確認

1. ローカル or 本番で `contact.html` を開く
2. 送信フォーム右下に **reCAPTCHA バッジ**が出ていれば reCAPTCHA 読込OK
3. テスト送信して「送信が完了しました」と緑のメッセージが出る
4. `info@limacon.co.jp` に通知メール、入力アドレスにサンキューメールが届く

> ⚠️ reCAPTCHA は `limacon.co.jp` ドメインでのみ動作します。
> ローカル（localhost）でフォーム全体をテストするには、reCAPTCHA管理画面で
> localhost をドメイン追加する必要があります。

---

## 関連ファイル

- `_partials/contact-form-gas.js` … GAS バックエンドの正本コード（GASエディタに貼る用）
- この手順書の最新の「動作版」は、`contact.html` を最後に修正したコミット
  （コミットメッセージに "contact form" を含むもの）を参照

---

*最終更新の動作版コミット: cba0865（2026-06-30 フォーム送信ロジック再注入）*
