export type ErrorKind = 'offline' | 'missing' | 'permission' | 'session' | 'server' | 'unknown';

export type DescribedError = {
  kind: ErrorKind;
  title: string;
  message: string;
  /** Raw code + message, shown small so the real cause is visible. */
  detail: string | null;
};

type ErrorLike = { code?: unknown; message?: unknown; status?: unknown; details?: unknown };

const NETWORK_PATTERNS =
  /failed to fetch|network request failed|networkerror|load failed|fetch failed|timed? ?out/i;

function isOffline() {
  return typeof navigator !== 'undefined' && 'onLine' in navigator && navigator.onLine === false;
}

/**
 * Turns Supabase / PostgREST / fetch errors into something a person can act
 * on: no internet, missing table or function (migrations not applied),
 * permission denied, expired session, or the raw server message.
 */
export function describeError(error: unknown): DescribedError {
  const e = (
    typeof error === 'object' && error !== null ? error : { message: String(error) }
  ) as ErrorLike;
  const code = typeof e.code === 'string' ? e.code : '';
  const message = typeof e.message === 'string' ? e.message : '';
  const status = typeof e.status === 'number' ? e.status : null;
  const detail = message ? (code ? `${code}: ${message}` : message) : code || null;

  if (isOffline() || NETWORK_PATTERNS.test(message)) {
    return {
      kind: 'offline',
      title: 'No connection',
      message: 'Couldn’t reach the server. Check your internet connection and try again.',
      detail,
    };
  }

  // Table / view / function the app expects isn't in the database.
  if (code === 'PGRST205' || code === '42P01') {
    const name = message.match(/'(?:public\.)?([\w.]+)'|relation "(?:public\.)?([\w.]+)"/);
    const table = name?.[1] ?? name?.[2];
    return {
      kind: 'missing',
      title: 'Database not set up',
      message: `The server is missing ${table ? `the “${table}” table` : 'a table'}. The database migrations probably haven’t been applied yet.`,
      detail,
    };
  }
  if (code === 'PGRST202' || code === '42883') {
    const fn = message.match(/function (?:public\.)?([\w]+)/)?.[1];
    return {
      kind: 'missing',
      title: 'Database not set up',
      message: `The server is missing ${fn ? `the “${fn}” function` : 'a function'}. The database migrations probably haven’t been applied yet.`,
      detail,
    };
  }

  if (
    code === 'PGRST301' ||
    code === 'PGRST302' ||
    status === 401 ||
    /jwt expired|invalid jwt/i.test(message)
  ) {
    return {
      kind: 'session',
      title: 'Session expired',
      message: 'Log out and sign in again.',
      detail,
    };
  }

  if (
    code === '42501' ||
    status === 403 ||
    /permission denied|row-level security|admin only/i.test(message)
  ) {
    return {
      kind: 'permission',
      title: 'Not allowed',
      message: 'Your account doesn’t have permission for this.',
      detail,
    };
  }

  if ((status !== null && status >= 500) || /^PGRST\d/.test(code) || /^[0-9A-Z]{5}$/.test(code)) {
    return {
      kind: 'server',
      title: 'Server error',
      message: message || 'The server returned an error.',
      detail,
    };
  }

  return {
    kind: 'unknown',
    title: 'Something went wrong',
    message: message || 'Please try again.',
    detail,
  };
}
