import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * Native session storage ("LargeSecureStore"). SecureStore (Keychain /
 * Keystore) is limited to ~2 KB, and a Supabase session is bigger, so:
 * a fresh random AES-256 key per write lives in SecureStore, and the session
 * encrypted with it lives in AsyncStorage. Without the key the stored value
 * is useless.
 */
const keyName = (key: string) => `${key.replace(/[^A-Za-z0-9._-]/g, '_')}.key`;

function encrypt(value: string, keyBytes: Uint8Array): string {
  // A new key every write, so a fixed counter start is safe.
  const cipher = new aesjs.ModeOfOperation.ctr(keyBytes, new aesjs.Counter(1));
  return aesjs.utils.hex.fromBytes(cipher.encrypt(aesjs.utils.utf8.toBytes(value)));
}

function decrypt(hex: string, keyBytes: Uint8Array): string {
  const cipher = new aesjs.ModeOfOperation.ctr(keyBytes, new aesjs.Counter(1));
  return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(hex)));
}

export const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    if (stored === null) return null;

    const keyHex = await SecureStore.getItemAsync(keyName(key));
    if (!keyHex) {
      // Session saved by an older build in plain AsyncStorage: use it once;
      // the next write stores it encrypted.
      return stored.startsWith('{') ? stored : null;
    }
    try {
      return decrypt(stored, aesjs.utils.hex.toBytes(keyHex));
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const keyBytes = getRandomBytes(32);
    const encrypted = encrypt(value, keyBytes);
    await SecureStore.setItemAsync(keyName(key), aesjs.utils.hex.fromBytes(keyBytes));
    await AsyncStorage.setItem(key, encrypted);
  },

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(keyName(key));
  },
};
