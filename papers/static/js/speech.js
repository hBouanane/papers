// Read text aloud with the browser's built-in voices, to hear how words are pronounced.
// No server, no account: it works offline on most systems.
const RATE_KEY = "papers.speechRate";

export const canSpeak = () => "speechSynthesis" in window;

export function speechRate() {
  try { return Number(localStorage.getItem(RATE_KEY)) || 1; } catch { return 1; }
}

export function setSpeechRate(rate) {
  try { localStorage.setItem(RATE_KEY, String(rate)); } catch { /* not remembered */ }
}

// An American English voice, the most natural-sounding one the system has
// (Edge's "Natural" voices and Chrome's "Google US English" sound best).
function usVoice() {
  const voices = speechSynthesis.getVoices().filter((v) => /^en[-_]us$/i.test(v.lang));
  const score = (v) => (/natural|neural|online/i.test(v.name) ? 3 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
  return voices.sort((a, b) => score(b) - score(a))[0] || null;
}

export function speak(text, { rate = speechRate(), onEnd } = {}) {
  if (!canSpeak() || !text.trim()) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/\s+/g, " ").trim());
  utterance.lang = "en-US";
  utterance.rate = rate;
  const voice = usVoice();
  if (voice) utterance.voice = voice;
  if (onEnd) { utterance.onend = onEnd; utterance.onerror = onEnd; }
  speechSynthesis.speak(utterance);
}

export const stopSpeaking = () => canSpeak() && speechSynthesis.cancel();
export const speaking = () => canSpeak() && speechSynthesis.speaking;

// Voices load asynchronously in some browsers; ask early so the first click has them.
if (canSpeak()) speechSynthesis.getVoices();
