// くまちゃんLIFF会話ページのロジック。
// 会話判定・要約は一切ここでやらない。GASウェブアプリに投げて返答をそのまま出すだけ。

const LIFF_ID = "2010967619-qjKBKYsy";
const GAS_URL = "https://script.google.com/macros/s/AKfycbwWImNJWxlJHzxwgbVut-0GxYT32OtbH8vsRWKyIYpBotodA_nTdd4a0GV-EMjOKLUp/exec";

const MODEL_URL = "assets/kuma.vrm";
const STILL_URL = "assets/kuma_still.png";

// ---- KumaView: 表示の切り替えをここに閉じ込める ----
// LINE内ブラウザ → 静止画1枚だけ(3Dの容量を一切落とさない)
// 外部ブラウザ   → 3Dモデル(kuma3d.js を動的に読み込む)
const KumaView = (() => {
  const img = document.getElementById("kumaImg");
  const canvas = document.getElementById("kumaCanvas");
  const fallback = document.getElementById("kumaFallback");
  const loading = document.getElementById("kumaLoading");
  const loadingText = document.getElementById("kumaLoadingText");
  const loadingFill = document.getElementById("kumaLoadingFill");

  let impl = null;      // 3Dが立ち上がったらここに入る
  let state = "idle";   // 3Dが来る前の操作もここで覚えておく

  img.addEventListener("error", () => {
    img.classList.remove("show");
    if (!impl) fallback.textContent = "くまちゃん";
  });
  img.addEventListener("load", () => {
    fallback.textContent = "";
    img.classList.add("show");
  });

  function showStill() {
    img.src = STILL_URL;
  }

  function setProgress(ratio) {
    const pct = Math.round(ratio * 100);
    loadingText.textContent = "くまちゃんを読み込み中 " + pct + "%";
    loadingFill.style.width = pct + "%";
  }

  // 3Dの読み込みに失敗しても会話は続ける。静止画にそのまま落とす
  async function mount3D() {
    loading.classList.add("show");
    setProgress(0);
    // canvasは先に表示しておく。display:noneのままだと幅も高さも0で初期化され、
    // 画面リサイズが起きるまで何も描画されない。
    img.classList.remove("show");
    canvas.classList.add("show");
    try {
      const mod = await import("./kuma3d.js");
      impl = await mod.createKuma3D({
        canvas: canvas,
        modelUrl: MODEL_URL,
        onProgress: setProgress,
      });
      impl.setState(state);
      fallback.textContent = "";
    } catch (err) {
      canvas.classList.remove("show");
      addLogMessage("kuma", "3Dの読み込みに失敗したみたい。" + (err && err.message ? "（" + err.message + "）" : ""));
      showStill();
    } finally {
      loading.classList.remove("show");
    }
  }

  function setState(next) {
    state = next;
    if (impl) impl.setState(next);
  }

  return {
    setState,
    getState: () => state,
    mount(use3D) {
      if (use3D) return mount3D();
      showStill();
      return Promise.resolve();
    },
    snapshot: () => (impl ? impl.snapshot() : null),
  };
})();

// ---- 会話ログ ----
const logEl = document.getElementById("log");
function addLogMessage(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + (role === "user" ? "user" : "kuma");
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

// ---- くまちゃんの返事を1文字ずつ出す ----
// このモデルには口のモーフが無いので口パクはしない。
// 「ゆっくり話す」(01_CHARACTER.md)は文字の出方で表す。画面をタップすると最後まで飛ぶ。
const TYPE_SPEED_MS = 45;
let skipTyping = false;

function typeOutMessage(text) {
  const div = addLogMessage("kuma", "");
  skipTyping = false;
  return new Promise((resolve) => {
    let i = 0;
    function step() {
      if (skipTyping) {
        div.textContent = text;
        logEl.scrollTop = logEl.scrollHeight;
        resolve();
        return;
      }
      div.textContent = text.slice(0, ++i);
      logEl.scrollTop = logEl.scrollHeight;
      if (i >= text.length) {
        resolve();
        return;
      }
      setTimeout(step, TYPE_SPEED_MS);
    }
    step();
  });
}

logEl.addEventListener("click", () => { skipTyping = true; });

// ---- 送信中の「…」表示 ----
let thinkingEl = null;
function showThinking() {
  thinkingEl = addLogMessage("kuma", "…");
  KumaView.setState("think");
}
function hideThinking() {
  if (thinkingEl) {
    thinkingEl.remove();
    thinkingEl = null;
  }
}

// ---- 読み上げ ----
const canSpeak = "speechSynthesis" in window;
let speechWarmedUp = false;
function warmUpSpeech() {
  if (!canSpeak || speechWarmedUp) return;
  speechWarmedUp = true;
  try {
    speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  } catch (_e) {}
}
// talk状態のときだけidleに戻す(戻す前に別の操作でlisten/thinkに移っていたら邪魔しない)
function backToIdleIfStillTalking() {
  if (KumaView.getState() === "talk") KumaView.setState("idle");
}

// 保険のタイマーは文字数に合わせる。固定値だと長い返事の途中で動きが止まる
const SPEECH_FALLBACK_BASE_MS = 1500;
const SPEECH_FALLBACK_PER_CHAR_MS = 180;
function speechFallbackMs(text) {
  return SPEECH_FALLBACK_BASE_MS + (text || "").length * SPEECH_FALLBACK_PER_CHAR_MS;
}

// 読み上げが終わったら(失敗しても/非対応でも)talk表示のまま固定されないようにidleへ戻す
function speak(text) {
  const fallbackMs = speechFallbackMs(text);
  if (!canSpeak) {
    setTimeout(backToIdleIfStillTalking, fallbackMs);
    return;
  }
  try {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    utter.rate = 0.85;
    utter.onend = backToIdleIfStillTalking;
    utter.onerror = backToIdleIfStillTalking;
    speechSynthesis.speak(utter);
    // 環境によってはonend/onerrorが来ないことがあるので保険で戻す
    setTimeout(backToIdleIfStillTalking, fallbackMs);
  } catch (_e) {
    // 読み上げが失敗しても会話は継続する
    setTimeout(backToIdleIfStillTalking, fallbackMs);
  }
}

// ---- GASウェブアプリとの通信 ----
const FETCH_TIMEOUT_MS = 20000;
let isSending = false; // 文字送信/音声送信のどちらからも多重送信させないためのフラグ

// ログインのやり直しは1回だけ。
// liff.login() はページを再読み込みするので、ただの変数では覚えておけない。
// sessionStorage に残して、戻ってきた後も判定できるようにする。
const LOGIN_RETRY_KEY = "kuma_login_retry";

function readLoginRetry() {
  try {
    return JSON.parse(sessionStorage.getItem(LOGIN_RETRY_KEY) || "null");
  } catch (_e) {
    return null;
  }
}
function writeLoginRetry(value) {
  try {
    sessionStorage.setItem(LOGIN_RETRY_KEY, JSON.stringify(value));
  } catch (_e) {}
}
function clearLoginRetry() {
  try {
    sessionStorage.removeItem(LOGIN_RETRY_KEY);
  } catch (_e) {}
}

// forceFresh: liff.login() はログイン済みだとIDトークンを更新しない。
// 期限切れトークンで弾かれている場合、logoutしてからでないと何度やっても同じトークンになる。
function retryLoginOnce(reason, forceFresh) {
  const previous = readLoginRetry();
  if (previous) {
    addLogMessage(
      "kuma",
      "ログインし直しても直らなかったよ。（1回目: " + previous.reason + " / 2回目: " + reason + "）"
    );
    return false;
  }
  writeLoginRetry({ reason: reason });
  if (forceFresh) {
    try {
      liff.logout();
    } catch (_e) {}
  }
  liff.login();
  return true;
}

async function sendToKuma(text) {
  if (isSending) return;
  isSending = true;
  showThinking();
  sendBtn.disabled = true;
  try {
    if (!GAS_URL) {
      addLogMessage("kuma", "うまく届かなかったみたい。");
      KumaView.setState("idle");
      return;
    }

    const idToken = liff.getIDToken();
    if (!idToken) {
      retryLoginOnce("IDトークンが取れない");
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ type: "liff_message", idToken, text }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
    const data = await res.json().catch(() => null);

    if (data && data.ok) {
      const reply = data.reply || "";
      clearLoginRetry(); // 会話が成立したのでログインの再試行記録を捨てる
      hideThinking();
      KumaView.setState("talk");
      speak(reply);
      await typeOutMessage(reply);
      return;
    }

    if (data && data.code === "auth") {
      // 期限切れの可能性が高いので、ログアウトしてトークンを取り直す
      retryLoginOnce("IDトークンの検証に失敗", true);
      return;
    }

    // 原因が分からないと直せないので、返ってきたcodeとmessageをそのまま出す
    const detail = data ? (data.code || "") + " " + (data.message || "") : "応答が読めない";
    addLogMessage("kuma", "うまく届かなかったみたい。（" + detail.trim() + "）");
    KumaView.setState("idle");
  } catch (err) {
    // 通信失敗・タイムアウト時はGASウェブアプリのURL・デプロイ設定を確認
    addLogMessage("kuma", "うまく届かなかったみたい。（" + (err && err.name === "AbortError" ? "時間切れ" : (err && err.message) || "通信失敗") + "）");
    KumaView.setState("idle");
  } finally {
    hideThinking();
    sendBtn.disabled = false;
    isSending = false;
  }
}

// ---- 文字入力 ----
const textInput = document.getElementById("textInput");
const sendBtn = document.getElementById("sendBtn");

function submitText() {
  if (isSending) return;
  const text = textInput.value.trim();
  if (!text) return;
  warmUpSpeech();
  addLogMessage("user", text);
  textInput.value = "";
  sendToKuma(text);
}

sendBtn.addEventListener("click", submitText);
textInput.addEventListener("keydown", (e) => {
  // IMEの変換確定Enterでは送信しない(isComposing非対応ブラウザ向けにkeyCode 229も見る)
  if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) submitText();
});

// ---- 音声(対応環境のみ)。機能検出ではなく実行結果でボタンの残し方を決める ----
const speakBtn = document.getElementById("speakBtn");
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let voiceGaveUp = false;

function fallbackToTextOnly() {
  if (voiceGaveUp) return;
  voiceGaveUp = true;
  speakBtn.style.display = "none";
  addLogMessage("kuma", "ここでは声が使えないみたい。文字で話そうか。");
}

function startListening() {
  if (!SpeechRecognitionCtor || voiceGaveUp) return;
  warmUpSpeech();
  const recognition = new SpeechRecognitionCtor();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.continuous = false;

  let settled = false;
  let listenTimer = null;
  function giveUpListening() {
    if (settled) return;
    settled = true;
    speakBtn.classList.remove("listening");
    KumaView.setState("idle");
  }

  // マイク許可ダイアログ待ちを巻き込まないよう、聞き取りが実際に始まる(onstart)まで
  // 5秒タイマーは開始しない。onstart自体が来ない端末向けに30秒の緩い上限だけ別途持つ。
  // タイムアウトは1回無反応だっただけなのでidleに戻すのみ(ボタンは消さない)
  const startCap = setTimeout(giveUpListening, 30000);
  recognition.onstart = () => {
    listenTimer = setTimeout(giveUpListening, 5000);
  };

  recognition.onresult = (e) => {
    settled = true;
    clearTimeout(startCap);
    clearTimeout(listenTimer);
    const text = e.results[0][0].transcript;
    if (text && text.trim() && !isSending) {
      addLogMessage("user", text);
      sendToKuma(text);
    }
  };
  recognition.onerror = (e) => {
    clearTimeout(startCap);
    clearTimeout(listenTimer);
    giveUpListening();
    if (["service-not-allowed", "not-allowed", "audio-capture"].includes(e.error)) {
      fallbackToTextOnly();
    }
  };
  recognition.onend = () => {
    clearTimeout(startCap);
    clearTimeout(listenTimer);
    speakBtn.classList.remove("listening");
  };

  speakBtn.classList.add("listening");
  KumaView.setState("listen");
  recognition.start();
}

if (SpeechRecognitionCtor) {
  speakBtn.style.display = "";
  speakBtn.addEventListener("click", startListening);
}

// ---- ブラウザで開く ----
// index.htmlが古いキャッシュのときにここで落ちるとページ全体が動かなくなるので存在確認する
const openBrowserBtn = document.getElementById("openBrowserBtn");
if (openBrowserBtn) {
  openBrowserBtn.addEventListener("click", () => {
    liff.openWindow({ url: location.href, external: true });
  });
}

// ---- 初期化 ----
async function init() {
  try {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      retryLoginOnce("未ログイン");
      return;
    }
    // 直前にログインし直していたら、その理由を出す。原因の切り分けに使う。
    const previousRetry = readLoginRetry();
    if (previousRetry) {
      addLogMessage("kuma", "（ログインし直したよ。理由: " + previousRetry.reason + "）");
    }

    // 3Dを読むのは「声が出る環境」だけにする。
    // liff.isInClient() は当てにならない(LINEのアプリ内ブラウザでURLを直接開くと false になる)。
    // 読み上げが使えないなら3Dを読む意味が薄いので、実際の機能の有無で判定する。
    const use3D = canSpeak;
    if (openBrowserBtn && !use3D) {
      openBrowserBtn.style.display = "";
    }
    await KumaView.mount(use3D);
  } catch (err) {
    addLogMessage("kuma", "起動に失敗したみたい。（" + ((err && err.message) || "原因不明") + "）");
    KumaView.mount(false);
  }
}
init();
