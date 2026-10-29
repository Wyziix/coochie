// Web / iPhone home-screen app: no push. A "New weekly report" badge in the
// app shows new reports instead (iOS web push isn't reliable enough yet).
export const supportsPush = false;

export async function registerPush(): Promise<boolean> {
  return false;
}

export async function askForPush(): Promise<boolean> {
  return false;
}

export async function pushAllowed(): Promise<boolean> {
  return false;
}

export async function unregisterPush(): Promise<void> {}

export function onNotificationTap(_open: (url: string) => void): () => void {
  return () => {};
}
