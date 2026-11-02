// "Install app": Android Chrome (and desktop Chrome/Edge) offer an install
// prompt through `beforeinstallprompt`, which fires early, once per page
// load, so captureInstallPrompt() runs before the app renders. iPhone has no
// prompt: the app shows the Share → Add to Home Screen steps instead.
import { isAndroid, isIos, isStandalone } from './pwa';

export type InstallState = 'installed' | 'prompt' | 'ios' | 'manual' | 'unavailable';

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: InstallPromptEvent | null = null;
let installed = false;
let captured = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function captureInstallPrompt() {
  if (captured || typeof window === 'undefined') return;
  captured = true;
  // Caught by the inline script in public/index.html before the app loaded.
  const early = (window as Window & { __installPrompt?: InstallPromptEvent }).__installPrompt;
  if (early) deferred = early;
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep it for the "Install app" button instead of the browser's mini-bar.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    changed();
  });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', changed);
}

export function installState(): InstallState {
  if (installed || isStandalone()) return 'installed';
  if (deferred) return 'prompt';
  if (isIos()) return 'ios';
  // Android browsers without the prompt (or Chrome before it fires): menu steps.
  if (isAndroid()) return 'manual';
  return 'unavailable';
}

/** Shows the browser's install dialog; true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null; // a prompt can only be used once
  await event.prompt();
  const { outcome } = await event.userChoice;
  changed();
  return outcome === 'accepted';
}

export function subscribeInstall(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
