// Native build: it's already an app.
export type InstallState = 'installed' | 'prompt' | 'ios' | 'manual' | 'unavailable';

export const installState = (): InstallState => 'installed';
export const promptInstall = async (): Promise<boolean> => false;
export const subscribeInstall = (_cb: () => void) => () => {};
export const captureInstallPrompt = () => {};
