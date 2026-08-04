// くまちゃんLIFF会話ページのロジック(TASK-010)。
// 会話判定・要約は一切ここでやらない。Workers API(/liff)に投げて返答をそのまま出すだけ。

const LIFF_ID = ""; // 運用者が後で書き換える
const WORKERS_URL = ""; // 運用者が後で書き換える(例: https://xxx.workers.dev/liff)

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
    fallback.textContent = current ? `くまちゃん(${current})` : "くまちゃん";
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
  return { setState };
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
function speak(text) {
  if (!canSpeak) return;
  try {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ja-JP";
    utter.rate = 0.85;
    speechSynthesis.speak(utter);
  } catch (_e) {
    // 読み上げが失敗しても会話は継続する
  }
}

// ---- Workers APIとの通信 ----
async function sendToKuma(text, isRetryAfterLogin) {
  showThinking();
  sendBtn.disabled = true;
  try {
    let idToken = liff.getIDToken();
    if (!idToken) {
      liff.login();
      return;
    }
    const res = await fetch(WORKERS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "liff_message", idToken, text }),
    });
    const data = await res.json().catch(() => null);
    hideThinking();

    if (data && data.ok) {
      const replyEl = addLogMessage("kuma", data.reply || "");
      KumaView.setState("talk");
      speak(data.reply || "");
      return;
    }

    if (data && data.code === "auth" && !isRetryAfterLogin) {
      liff.login();
      return;
    }

    addLogMessage("kuma", "うまく届かなかったみたい。");
    KumaView.setState("idle");
  } catch (err) {
    // 通信失敗時は TASK-009 の LIFF_ALLOWED_ORIGIN 設定を確認
    hideThinking();
    addLogMessage("kuma", "うまく届かなかったみたい。");
    KumaView.setState("idle");
  } finally {
    sendBtn.disabled = false;
  }
}

// ---- 文字入力 ----
const textInput = document.getElementById("textInput");
const sendBtn = document.getElementById("sendBtn");

function submitText() {
  const text = textInput.value.trim();
  if (!text) return;
  warmUpSpeech();
  addLogMessage("user", text);
  textInput.value = "";
  sendToKuma(text);
}

sendBtn.addEventListener("click", submitText);
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitText();
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
  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      speakBtn.classList.remove("listening");
      KumaView.setState("idle");
      fallbackToTextOnly();
    }
  }, 5000);

  recognition.onresult = (e) => {
    settled = true;
    clearTimeout(timer);
    const text = e.results[0][0].transcript;
    if (text && text.trim()) {
      addLogMessage("user", text);
      sendToKuma(text);
    }
  };
  recognition.onerror = (e) => {
    settled = true;
    clearTimeout(timer);
    speakBtn.classList.remove("listening");
    KumaView.setState("idle");
    if (["service-not-allowed", "not-allowed", "audio-capture"].includes(e.error)) {
      fallbackToTextOnly();
    }
  };
  recognition.onend = () => {
    clearTimeout(timer);
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

// ---- 初期化 ----
async function init() {
  try {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) {
      liff.login();
    }
  } catch (err) {
    addLogMessage("kuma", "うまく届かなかったみたい。");
  }
}
init();
