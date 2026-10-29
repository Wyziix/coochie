import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { sessionStorage } from '@/lib/auth/sessionStorage';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});

const KEY = 'sb-gwyymvaxgmpamtiuhoez-auth-token';
const session = JSON.stringify({
  access_token: 'a'.repeat(3000),
  refresh_token: 'r',
  user: { id: 'u' },
});

describe('native session storage', () => {
  beforeEach(() => AsyncStorage.clear());

  it('round-trips a session larger than SecureStore allows', async () => {
    await sessionStorage.setItem(KEY, session);
    expect(await sessionStorage.getItem(KEY)).toBe(session);
  });

  it('never writes the session in plain text', async () => {
    await sessionStorage.setItem(KEY, session);
    const raw = await AsyncStorage.getItem(KEY);
    expect(raw).not.toContain('access_token');
    expect(raw).toMatch(/^[0-9a-f]+$/);
    // Only the 32-byte key goes into SecureStore, under a valid key name.
    const [name, value] = jest.mocked(SecureStore.setItemAsync).mock.calls.at(-1)!;
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(value).toHaveLength(64);
  });

  it('is unreadable without the key', async () => {
    await sessionStorage.setItem(KEY, session);
    await SecureStore.deleteItemAsync(`${KEY}.key`);
    expect(await sessionStorage.getItem(KEY)).toBeNull();
  });

  it('migrates a plain session saved by an older build', async () => {
    await AsyncStorage.setItem(KEY, session);
    expect(await sessionStorage.getItem(KEY)).toBe(session);
  });

  it('removes both parts', async () => {
    await sessionStorage.setItem(KEY, session);
    await sessionStorage.removeItem(KEY);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(await SecureStore.getItemAsync(`${KEY}.key`)).toBeNull();
  });
});
