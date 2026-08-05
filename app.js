// くまちゃんLIFF会話ページのロジック。
// 会話判定・要約は一切ここでやらない。GASウェブアプリに投げて返答をそのまま出すだけ。

const LIFF_ID = "2010967619-qjKBKYsy";
const GAS_URL = "https://script.google.com/macros/s/AKfycbwWImNJWxlJHzxwgbVut-0GxYT32OtbH8vsRWKyIYpBotodA_nTdd4a0GV-EMjOKLUp/exec";

// ---- KumaView: 画像切り替えをここに閉じ込める。3Dに差し替えるときはここだけ入れ替える ----
const KumaView = (() => {
  const img = document.getElementById("kumaImg");
  const fallback = document.getElementById("kumaFallback");
  const FILES = {
    idle: "assets/kuma_idle.png",
    listen: "assets/kuma_listen.png",
    think: "assets/kuma_think.png",
    talk: "assets/kuma_talk.png",
  };
  let current = null;

  img.addEventListener("error", () => {
    img.classList.remove("show");
    fallback.textContent = "くまちゃん";
  });
  img.addEventListener("load", () => {
    fallback.textContent = "";
    img.classList.add("show");
  });

  function setState(state) {
    if (!FILES[state]) return;
    current = state;
    img.classList.remove("show");
    img.src = FILES[state];
  }

  setState("idle");
  return { setState, getState: () => current };
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

// 読み上げが終わったら(失敗しても/非対応でも)talk表示のまま固定されないようにidleへ戻す
function speak(text) {
  if (!canSpeak) {
    setTimeout(backToIdleIfStillTalking, 3000);
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
    setTimeout(backToIdleIfStillTalking, 3000);
  } catch (_e) {
    // 読み上げが失敗しても会話は継続する
    setTimeout(backToIdleIfStillTalking, 3000);
  }
}

// ---- GASウェブアプリとの通信 ----
const FETCH_TIMEOUT_MS = 20000;
let isSending = false; // 文字送信/音声送信のどちらからも多重送信させないためのフラグ

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
      liff.login();
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
      addLogMessage("kuma", data.reply || "");
      KumaView.setState("talk");
      speak(data.reply || "");
      return;
    }

    if (data && data.code === "auth") {
      liff.login();
      return;
    }

    addLogMessage("kuma", "うまく届かなかったみたい。");
    KumaView.setState("idle");
  } catch (err) {
    // 通信失敗・タイムアウト時はGASウェブアプリのURL・デプロイ設定を確認
    addLogMessage("kuma", "うまく届かなかったみたい。");
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
      liff.login();
    }
    if (openBrowserBtn && liff.isInClient()) {
      openBrowserBtn.style.display = "";
    }
  } catch (err) {
    addLogMessage("kuma", "うまく届かなかったみたい。");
  }
}
init();
