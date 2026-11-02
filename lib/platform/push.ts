// The app is web-only now (installed from the browser); push is web push
// (push.web.ts). The native build keeps compiling but has no push.
export type PushState = 'unsupported' | 'needs_install' | 'denied' | 'off' | 'on';

export async function pushState(): Promise<PushState> {
  return 'unsupported';
}

export async function enablePush(): Promise<PushState> {
  return 'unsupported';
}

export async function disablePush(): Promise<void> {}

export async function registerPush(): Promise<boolean> {
  return false;
}

export async function unregisterPush(): Promise<void> {}

export async function pushIsOn(): Promise<boolean> {
  return false;
}

export function onNotificationTap(_open: (url: string) => void): () => void {
  return () => {};
}
