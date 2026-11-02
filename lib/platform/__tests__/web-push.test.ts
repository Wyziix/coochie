// The web versions (push.web, install.web, saveFile.web, notifications.web)
// with small fake browser APIs (the React Native test environment has no DOM).
jest.mock('@/lib/platform/pwa', () => jest.requireActual('@/lib/platform/pwa.web'));
jest.mock('@/lib/env', () => ({
  env: {
    supabaseUrl: 'https://test.supabase.co',
    supabasePublishableKey: 'sb_publishable_test',
    vapidPublicKey:
      'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  },
  isSupabaseConfigured: true,
}));
const mockSaveWebPush = jest.fn(async () => {});
const mockDeleteWebPush = jest.fn(async () => {});
const mockCallPushRpc = jest.fn(async () => true);
jest.mock('@/lib/api/push', () => ({
  saveWebPush: (...a: unknown[]) => mockSaveWebPush(...(a as [])),
  deleteWebPush: (...a: unknown[]) => mockDeleteWebPush(...(a as [])),
  callPushRpc: (...a: unknown[]) => mockCallPushRpc(...(a as [])),
}));

type Perm = 'default' | 'granted' | 'denied';

function setUa(ua: string, touch = 0) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true });
}
function setStandalone(on: boolean) {
  Object.defineProperty(navigator, 'standalone', { value: on, configurable: true });
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes('standalone'),
    addEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function fakeBrowser(opts: { permission?: Perm; ask?: Perm; subscribed?: boolean } = {}) {
  let permission: Perm = opts.permission ?? 'default';
  const sub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    getKey: (name: string) => new Uint8Array(name === 'auth' ? 16 : 65).fill(1).buffer,
    unsubscribe: jest.fn(async () => true),
  };
  let current = opts.subscribed ? sub : null;
  const pushManager = {
    getSubscription: jest.fn(async () => current),
    subscribe: jest.fn(async () => (current = sub)),
  };
  const requestPermission = jest.fn(async () => (permission = opts.ask ?? 'granted'));
  const NotificationFake = Object.assign(function Notification() {}, { requestPermission });
  Object.defineProperty(NotificationFake, 'permission', { get: () => permission });
  Object.defineProperty(window, 'Notification', { value: NotificationFake, configurable: true });
  Object.defineProperty(window, 'PushManager', {
    value: function PushManager() {},
    configurable: true,
  });
  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      ready: Promise.resolve({ pushManager }),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
    configurable: true,
  });
  return { pushManager, requestPermission, sub };
}

const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1';

function fakeDom() {
  const win = new EventTarget();
  Object.assign(window, {
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: win.removeEventListener.bind(win),
    dispatchEvent: win.dispatchEvent.bind(win),
  });
  const doc = new EventTarget() as EventTarget & Record<string, unknown>;
  const anchor = { click: jest.fn(), remove: jest.fn(), href: '', download: '', rel: '' };
  Object.assign(doc, {
    visibilityState: 'visible',
    createElement: () => anchor,
    body: { appendChild: jest.fn() },
  });
  Object.defineProperty(global, 'document', { value: doc, configurable: true });
  return { anchor };
}

let dom: ReturnType<typeof fakeDom>;
beforeEach(() => {
  jest.clearAllMocks();
  dom = fakeDom();
  setUa(ANDROID);
  setStandalone(false);
});

describe('web push', () => {
  const push = () =>
    jest.requireActual('@/lib/platform/push.web') as typeof import('@/lib/platform/push.web');

  it('never asks on its own: state and start-up refresh leave the permission alone', async () => {
    const b = fakeBrowser();
    expect(await push().pushState()).toBe('off');
    expect(await push().registerPush()).toBe(false);
    expect(b.requestPermission).not.toHaveBeenCalled();
    expect(b.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('enablePush (from a tap): asks, subscribes with the VAPID key, saves to the server', async () => {
    const b = fakeBrowser();
    expect(await push().enablePush()).toBe('on');
    expect(b.requestPermission).toHaveBeenCalledTimes(1);
    const options = (b.pushManager.subscribe.mock.calls[0] as unknown[])[0] as {
      userVisibleOnly: boolean;
      applicationServerKey: Uint8Array;
    };
    expect(options.userVisibleOnly).toBe(true);
    expect(options.applicationServerKey).toHaveLength(65);
    expect(options.applicationServerKey[0]).toBe(4);
    expect(mockSaveWebPush).toHaveBeenCalledWith({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      p256dh: expect.stringMatching(/^[\w-]{87}$/),
      auth: expect.stringMatching(/^[\w-]{22}$/),
    });
    expect(await push().pushState()).toBe('on');
  });

  it('blocked stays blocked; turning off removes it here and on the server', async () => {
    fakeBrowser({ ask: 'denied' });
    expect(await push().enablePush()).toBe('denied');
    const b = fakeBrowser({ permission: 'granted', subscribed: true });
    await push().disablePush();
    expect(mockDeleteWebPush).toHaveBeenCalledWith('https://fcm.googleapis.com/fcm/send/abc');
    expect(b.sub.unsubscribe).toHaveBeenCalled();
  });

  it('iPhone: only in the home-screen app', async () => {
    setUa(IPHONE, 5);
    const b = fakeBrowser();
    expect(await push().pushState()).toBe('needs_install');
    expect(await push().enablePush()).toBe('needs_install');
    expect(b.requestPermission).not.toHaveBeenCalled();
    setStandalone(true);
    expect(await push().enablePush()).toBe('on');
  });

  it('already allowed: start-up keeps the subscription on this user', async () => {
    fakeBrowser({ permission: 'granted', subscribed: true });
    expect(await push().registerPush()).toBe(true);
    expect(mockSaveWebPush).toHaveBeenCalledTimes(1);
  });
});

describe('install', () => {
  const load = () => {
    let mod!: typeof import('@/lib/platform/install.web');
    jest.isolateModules(() => {
      mod = jest.requireActual('@/lib/platform/install.web');
    });
    return mod;
  };

  it('Android Chrome: keeps the prompt for the button and shows it on tap', async () => {
    const install = load();
    install.captureInstallPrompt();
    expect(install.installState()).toBe('manual');
    const prompt = jest.fn(async () => {});
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(install.installState()).toBe('prompt');
    expect(await install.promptInstall()).toBe(true);
    expect(prompt).toHaveBeenCalled();
    window.dispatchEvent(new Event('appinstalled'));
    expect(install.installState()).toBe('installed');
  });

  it('a prompt caught before the app loaded (index.html) is used too', () => {
    (window as unknown as { __installPrompt: unknown }).__installPrompt = { prompt: jest.fn() };
    const install = load();
    install.captureInstallPrompt();
    expect(install.installState()).toBe('prompt');
    delete (window as unknown as { __installPrompt?: unknown }).__installPrompt;
  });

  it('iPhone Safari gets the guide; the installed app hides the button', () => {
    setUa(IPHONE, 5);
    expect(load().installState()).toBe('ios');
    setStandalone(true);
    expect(load().installState()).toBe('installed');
    setStandalone(false);
    setUa(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.1 Safari/605.1.15',
      5,
    );
    expect(load().installState()).toBe('ios'); // iPad
  });
});

describe('saving the export', () => {
  const save = () =>
    jest.requireActual(
      '@/lib/platform/saveFile.web',
    ) as typeof import('@/lib/platform/saveFile.web');

  it('iPhone: the share sheet with the file (works in the home-screen app)', async () => {
    setUa(IPHONE, 5);
    const share = jest.fn(async () => {});
    Object.assign(navigator, { canShare: () => true, share });
    expect(await save().saveFile(new Blob(['x'], { type: 'application/zip' }), 'export.zip')).toBe(
      'shared',
    );
    const files = (share.mock.calls[0] as unknown as [{ files: File[] }])[0].files;
    expect(files[0]!.name).toBe('export.zip');
  });

  it('iPhone share cancelled: nothing else happens', async () => {
    setUa(IPHONE, 5);
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    Object.assign(navigator, {
      canShare: () => true,
      share: jest.fn(async () => Promise.reject(abort)),
    });
    expect(await save().saveFile(new Blob(['x']), 'export.zip')).toBe('cancelled');
  });

  it('Android and desktop: a normal download', async () => {
    jest.useFakeTimers();
    URL.createObjectURL = jest.fn(() => 'blob:x');
    URL.revokeObjectURL = jest.fn();
    expect(await save().saveFile(new Blob(['x']), 'export.zip')).toBe('saved');
    expect(dom.anchor.download).toBe('export.zip');
    expect(dom.anchor.click).toHaveBeenCalled();
    jest.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    jest.useRealTimers();
  });
});

describe('rest timer push', () => {
  const rest = () =>
    jest.requireActual(
      '@/lib/platform/notifications.web',
    ) as typeof import('@/lib/platform/notifications.web');
  const setVisibility = (v: 'visible' | 'hidden') => {
    (document as unknown as Record<string, unknown>).visibilityState = v;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('only scheduled while the app is in the background, cancelled on return or skip', async () => {
    const pushMock = jest.requireMock('@/lib/platform/push') as { pushIsOn: jest.Mock };
    pushMock.pushIsOn.mockResolvedValue(true);
    setVisibility('visible');
    const id = await rest().scheduleRestNotification(90, 'Bench press');
    expect(id).toBe('rest');
    expect(mockCallPushRpc).not.toHaveBeenCalled();
    setVisibility('hidden');
    expect(mockCallPushRpc).toHaveBeenLastCalledWith('schedule_push', {
      p_tag: 'rest',
      p_seconds: expect.any(Number),
      p_title: 'Rest is over',
      p_body: 'Next set: Bench press',
    });
    setVisibility('visible');
    expect(mockCallPushRpc).toHaveBeenLastCalledWith('cancel_push', { p_tag: 'rest' });
    setVisibility('hidden');
    await rest().cancelRestNotification(id);
    expect(mockCallPushRpc).toHaveBeenLastCalledWith('cancel_push', { p_tag: 'rest' });
    mockCallPushRpc.mockClear();
    setVisibility('hidden');
    expect(mockCallPushRpc).not.toHaveBeenCalled();
    pushMock.pushIsOn.mockResolvedValue(false);
  });

  it('push off: nothing is scheduled', async () => {
    expect(await rest().scheduleRestNotification(90, 'Squat')).toBeNull();
  });
});
