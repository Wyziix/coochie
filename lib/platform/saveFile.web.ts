// Saves a file from the app. Call it straight from a tap.
// - iPhone/iPad (Safari and the home-screen app): the share sheet with the
//   file ("Save to Files", AirDrop, Mail...). A plain download in the
//   home-screen app opens a preview with no way back, so it's not used there.
// - Everywhere else (Android Chrome, desktop): a normal download.
import { isIos } from './pwa';

export type SaveResult = 'saved' | 'shared' | 'cancelled' | 'unsupported';

export async function saveFile(blob: Blob, filename: string): Promise<SaveResult> {
  const file = new File([blob], filename, { type: blob.type || 'application/zip' });
  if (
    isIos() &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return 'cancelled';
      // Not allowed (no tap) or failed: fall back to the download below.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before freeing the file.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'saved';
}
