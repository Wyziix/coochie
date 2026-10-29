import { randomUUID } from 'expo-crypto';

/** UUID v4, generated on the device (works on native and web). */
export const newId = () => randomUUID();
