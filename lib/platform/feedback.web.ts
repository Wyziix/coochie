// Web fallback for haptics and the rest-timer notification: a short beep via
// the Web Audio API (no sound file needed) and navigator.vibrate where it
// exists (Android Chrome; iPhone Safari has no vibration API).

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/**
 * Browsers (iOS Safari especially) only allow sound after a user gesture.
 * Called when a set is ticked off, which is exactly when the timer starts.
 */
export function primeAlertSound() {
  const a = audio();
  if (a && a.state === 'suspended') a.resume().catch(() => {});
}

function beep(at: number, freq: number) {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, a.currentTime + at);
  gain.gain.exponentialRampToValueAtTime(0.3, a.currentTime + at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + 0.25);
  osc.connect(gain).connect(a.destination);
  osc.start(a.currentTime + at);
  osc.stop(a.currentTime + at + 0.3);
}

const vibrate = (pattern: number[]) => {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
};

export function tapFeedback() {
  vibrate([10]);
}

export function restDoneAlert() {
  try {
    beep(0, 880);
    beep(0.35, 880);
    beep(0.7, 1320);
  } catch {
    // Audio blocked: the on-screen alert still shows.
  }
  vibrate([200, 100, 200]);
}
