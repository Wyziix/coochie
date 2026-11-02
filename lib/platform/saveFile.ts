// Native build: saving files isn't supported (the app is web-only now).
export type SaveResult = 'saved' | 'shared' | 'cancelled' | 'unsupported';

export async function saveFile(_blob: Blob, _filename: string): Promise<SaveResult> {
  return 'unsupported';
}
