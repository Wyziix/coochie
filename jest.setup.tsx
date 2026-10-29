// The nested-pressable check in jest.after-env.ts runs before cleanup, so do cleanup there.
process.env.RNTL_SKIP_AUTO_CLEANUP = 'true';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Icon fonts are loaded through expo-asset, which has no asset registry in Jest.
jest.mock('@expo/vector-icons/Ionicons', () => {
  const { Text } = require('react-native');
  const Icon = ({ name }: { name: string }) => <Text>{`icon:${name}`}</Text>;
  return { __esModule: true, default: Icon };
});

// expo-crypto's native module isn't available in Jest; use Node's crypto.
jest.mock('expo-crypto', () => {
  const nodeCrypto = require('crypto');
  return {
    randomUUID: () => nodeCrypto.randomUUID(),
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
  };
});

// Offline storage (IndexedDB / SQLite) → memory. Cleared between test files.
jest.mock('@/lib/offline/storage', () => {
  const memory = new Map<string, string>();
  return {
    __memory: memory,
    offlineStorage: {
      getItem: async (key: string) => memory.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        memory.set(key, value);
      },
      removeItem: async (key: string) => {
        memory.delete(key);
      },
    },
  };
});

// Online by default; tests flip it with onlineManager.setOnline().
jest.mock('@/lib/platform/network', () => ({
  subscribeOnline: (onChange: (online: boolean) => void) => {
    onChange(true);
    return () => {};
  },
}));
