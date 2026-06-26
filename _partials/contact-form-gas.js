/**
 * ============================================================================
 *  株式会社Limaçon お問い合わせフォーム バックエンド (Google Apps Script)
 * ============================================================================
 *
 *  構成: ブラウザ(contact.html + reCAPTCHA v3)
 *          → fetch(POST) → このGAS(Web App)
 *          → reCAPTCHA検証 → Microsoft Graph API
 *          → info@limacon.co.jp として送信
 *            ・社内通知メール（TO_EMAIL 宛）
 *            ・サンキューメール（送信者宛）
 *
 *  ■ このファイルはリポジトリ上の「正本」です。
 *    GAS エディタにコピペして使ってください（直接 import はされません）。
 *
 *  ■ 機密値はコードに書かない。GAS の「スクリプト プロパティ」に登録する:
 *      GASエディタ → ⚙️プロジェクトの設定 → スクリプト プロパティ
 *        TENANT_ID         … Entra: ディレクトリ(テナント)ID
 *        CLIENT_ID         … Entra: アプリケーション(クライアント)ID
 *        CLIENT_SECRET     … Entra: クライアントシークレットの「値」
 *        RECAPTCHA_SECRET  … reCAPTCHA v3 の Secret Key
 *
 *  ■ デプロイ:
 *      デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *        次のユーザーとして実行: 自分(info@limacon.co.jp)
 *        アクセスできるユーザー: 全員  ★必須(CORS回避)
 *      → 発行された Web App URL を contact.html の GAS_ENDPOINT に設定
 *
 *  ============================================================================
 */

/* ===== 設定（会社固有・公開してOKな値）===== */
var CONFIG = {
  SENDER_EMAIL:     'info@limacon.co.jp',          // Graph で送信元にするアドレス(Exchangeに存在必須)
  TO_EMAIL:         'info@limacon.co.jp',          // 社内通知メールの宛先
  FROM_NAME:        '株式会社Limaçon',              // 差出人表示名
  COMPANY_NAME:     '株式会社Limaçon',              // 本文で使う会社名
  COMPANY_URL:      'https://limacon.co.jp/',       // サンキューメール末尾のURL
  SUBJECT_PREFIX:   '【HP問い合わせ】',              // 社内通知メールの件名プレフィックス
  THANKYOU_SUBJECT: '【株式会社Limaçon】お問い合わせを受け付けました',
  REPLY_DEADLINE:   '3営業日以内',                  // サンキューメールに記載する返信目安
  SUPPORT_HOURS:    '平日 10:00〜19:00（祝日・年末年始を除く）',
  SUPPORT_TEL:      '03-6821-0177',

  ENABLE_RECAPTCHA:    true,   // reCAPTCHA v3 検証を行うか
  RECAPTCHA_MIN_SCORE: 0.5,    // このスコア未満は弾く（0.0〜1.0）
  RECAPTCHA_ACTION:    'contact_submit', // フロントの grecaptcha.execute の action と一致させる

  ENABLE_THANKYOU: true        // 送信者へのサンキューメールを送るか
};

/* ===== Graph 定数 ===== */
var GRAPH_TOKEN_URL = 'https://login.microsoftonline.com/%TENANT%/oauth2/v2.0/token';
var GRAPH_SEND_URL  = 'https://graph.microsoft.com/v1.0/users/%SENDER%/sendMail';
var RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

/* ============================================================================
 *  エントリポイント
 * ========================================================================== */

function doPost(e) {
  try {
    var data = parsePayload_(e);

    // 1) reCAPTCHA 検証
    if (CONFIG.ENABLE_RECAPTCHA) {
      var rc = verifyRecaptcha_(data.token, data.remoteip);
      if (!rc.ok) {
        return jsonOut_({ ok: false, error: 'recaptcha', detail: rc.detail });
      }
    }

    // 2) 必須項目チェック
    var v = validate_(data);
    if (!v.ok) {
      return jsonOut_({ ok: false, error: 'validation', detail: v.detail });
    }

    // 3) Graph トークン取得
    var token = getGraphToken_();

    // 4) 社内通知メール送信
    sendMailViaGraph_(token, {
      to:      CONFIG.TO_EMAIL,
      subject: CONFIG.SUBJECT_PREFIX + buildSubject_(data),
      body:    buildAdminBody_(data),
      replyTo: data.email
    });

    // 5) サンキューメール送信（任意）
    if (CONFIG.ENABLE_THANKYOU && data.email) {
      sendMailViaGraph_(token, {
        to:      data.email,
        subject: CONFIG.THANKYOU_SUBJECT,
        body:    buildThankYouBody_(data),
        replyTo: CONFIG.TO_EMAIL
      });
    }

    return jsonOut_({ ok: true });

  } catch (err) {
    // 失敗詳細はGASの実行ログにのみ残す（ユーザーには汎用エラー）
    Logger.log('doPost error: ' + (err && err.stack ? err.stack : err));
    return jsonOut_({ ok: false, error: 'server', detail: String(err) });
  }
}

// 動作確認用（ブラウザでURLを直接開くと表示される）
function doGet(e) {
  return jsonOut_({ ok: true, service: 'Limacon contact form', method: 'use POST' });
}

/* ============================================================================
 *  入力処理
 * ========================================================================== */

function parsePayload_(e) {
  var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
  var obj;
  try { obj = JSON.parse(raw); } catch (x) { obj = {}; }
  return {
    category: trim_(obj.category),
    name:     trim_(obj.name),
    company:  trim_(obj.company),
    email:    trim_(obj.email),
    tel:      trim_(obj.tel),
    message:  trim_(obj.message),
    agree:    obj.agree === true || obj.agree === 'true',
    token:    trim_(obj.token),
    remoteip: trim_(obj.remoteip)
  };
}

function validate_(d) {
  if (!d.name)    return { ok: false, detail: 'name required' };
  if (!d.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email))
                  return { ok: false, detail: 'email invalid' };
  if (!d.message) return { ok: false, detail: 'message required' };
  if (!d.agree)   return { ok: false, detail: 'agreement required' };
  return { ok: true };
}

/* ============================================================================
 *  reCAPTCHA v3 検証
 * ========================================================================== */

function verifyRecaptcha_(token, remoteip) {
  if (!token) return { ok: false, detail: 'no token' };
  var secret = prop_('RECAPTCHA_SECRET');
  if (!secret) throw new Error('RECAPTCHA_SECRET not set in script properties');

  var params = { secret: secret, response: token };
  if (remoteip) params.remoteip = remoteip;

  var res = UrlFetchApp.fetch(RECAPTCHA_VERIFY_URL, {
    method: 'post',
    payload: params,
    muteHttpExceptions: true
  });
  var body = JSON.parse(res.getContentText() || '{}');

  if (!body.success) return { ok: false, detail: 'verify failed: ' + JSON.stringify(body['error-codes'] || []) };
  if (typeof body.score === 'number' && body.score < CONFIG.RECAPTCHA_MIN_SCORE)
    return { ok: false, detail: 'low score: ' + body.score };
  if (CONFIG.RECAPTCHA_ACTION && body.action && body.action !== CONFIG.RECAPTCHA_ACTION)
    return { ok: false, detail: 'action mismatch: ' + body.action };

  return { ok: true, score: body.score };
}

/* ============================================================================
 *  Microsoft Graph: トークン取得 & メール送信
 * ========================================================================== */

function getGraphToken_() {
  var tenant = prop_('TENANT_ID');
  var client = prop_('CLIENT_ID');
  var secret = prop_('CLIENT_SECRET');
  if (!tenant || !client || !secret)
    throw new Error('TENANT_ID / CLIENT_ID / CLIENT_SECRET must be set in script properties');

  var url = GRAPH_TOKEN_URL.replace('%TENANT%', encodeURIComponent(tenant));
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    payload: {
      client_id:     client,
      client_secret: secret,
      scope:         'https://graph.microsoft.com/.default',
      grant_type:    'client_credentials'
    },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText() || '{}');
  if (code !== 200 || !body.access_token) {
    throw new Error('token error HTTP ' + code + ': ' + res.getContentText());
  }
  return body.access_token;
}

function sendMailViaGraph_(token, mail) {
  var url = GRAPH_SEND_URL.replace('%SENDER%', encodeURIComponent(CONFIG.SENDER_EMAIL));
  var payload = {
    message: {
      subject: mail.subject,
      body: { contentType: 'Text', content: mail.body },
      toRecipients: [{ emailAddress: { address: mail.to } }],
      from: { emailAddress: { address: CONFIG.SENDER_EMAIL, name: CONFIG.FROM_NAME } }
    },
    saveToSentItems: true
  };
  if (mail.replyTo) {
    payload.message.replyTo = [{ emailAddress: { address: mail.replyTo } }];
  }

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code !== 202) {
    throw new Error('sendMail error HTTP ' + code + ': ' + res.getContentText());
  }
}

/* ============================================================================
 *  メール本文
 * ========================================================================== */

function buildSubject_(d) {
  var who = d.company ? (d.company + ' / ' + d.name) : d.name;
  return who + ' 様よりお問い合わせ';
}

function buildAdminBody_(d) {
  return [
    'ホームページのお問い合わせフォームより、以下の内容で送信がありました。',
    '',
    '──────────────────────────────',
    '■ お問い合わせ種別: ' + (d.category || '（未選択）'),
    '■ お名前        : ' + d.name,
    '■ 会社名        : ' + (d.company || '（未入力）'),
    '■ メールアドレス: ' + d.email,
    '■ 電話番号      : ' + (d.tel || '（未入力）'),
    '──────────────────────────────',
    '■ お問い合わせ内容:',
    d.message,
    '──────────────────────────────',
    '',
    '※ このメールは自動送信です。返信は送信者(' + d.email + ')宛に行ってください。'
  ].join('\n');
}

function buildThankYouBody_(d) {
  return [
    d.name + ' 様',
    '',
    'この度は' + CONFIG.COMPANY_NAME + 'へお問い合わせいただき、誠にありがとうございます。',
    '以下の内容でお問い合わせを受け付けました。',
    '担当者より' + CONFIG.REPLY_DEADLINE + 'にご返信いたしますので、今しばらくお待ちください。',
    '',
    '──────────────────────────────',
    '■ お問い合わせ種別: ' + (d.category || '（未選択）'),
    '■ お名前        : ' + d.name,
    '■ 会社名        : ' + (d.company || '（未入力）'),
    '■ メールアドレス: ' + d.email,
    '■ 電話番号      : ' + (d.tel || '（未入力）'),
    '■ お問い合わせ内容:',
    d.message,
    '──────────────────────────────',
    '',
    '※ ' + CONFIG.REPLY_DEADLINE + 'を過ぎても返信がない場合は、お手数ですが',
    '　 下記までお電話にてお問い合わせください。',
    '',
    CONFIG.COMPANY_NAME,
    'TEL: ' + CONFIG.SUPPORT_TEL + '（' + CONFIG.SUPPORT_HOURS + '）',
    CONFIG.COMPANY_URL,
    '',
    '※ このメールは送信専用アドレスから自動送信されています。'
  ].join('\n');
}

/* ============================================================================
 *  ユーティリティ
 * ========================================================================== */

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function trim_(s) {
  return (s == null) ? '' : String(s).trim();
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
