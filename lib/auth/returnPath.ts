// Where to go after a Google sign-in redirect (web), e.g. back to "Delete
// account" after signing in again. Kept for this tab only.
const KEY = 'lwb:return-to';

export function setReturnPath(path: string) {
  try {
    globalThis.sessionStorage?.setItem(KEY, path);
  } catch {
    // storage blocked: you land on Home instead
  }
}

/** The saved path (only app paths), removed once read. */
export function takeReturnPath(): string | null {
  try {
    const path = globalThis.sessionStorage?.getItem(KEY) ?? null;
    globalThis.sessionStorage?.removeItem(KEY);
    return path && path.startsWith('/') && !path.startsWith('//') ? path : null;
  } catch {
    return null;
  }
}
