// New-order alerts: vibration (Capacitor Haptics on the phone, navigator.vibrate in a browser) and a Web Audio beep
// that only plays after the person has switched "Sound" on (that tap also unlocks audio in the browser).
import { Capacitor } from "@capacitor/core";
import { Haptics } from "@capacitor/haptics";

let ctx = null;

export function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = ctx || new AC();
    if (ctx.state === "suspended") ctx.resume();
    return true;
  } catch { return false; }
}

export function beep() {
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime;
    [880, 1175, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + i * 0.22);
      o.stop(t0 + i * 0.22 + 0.22);
    });
  } catch { /* audio blocked */ }
}

export function vibrate() {
  try {
    if (Capacitor.isNativePlatform()) Haptics.vibrate({ duration: 400 });
    else if (navigator.vibrate) navigator.vibrate([250, 120, 250]);
  } catch { /* not supported */ }
}
