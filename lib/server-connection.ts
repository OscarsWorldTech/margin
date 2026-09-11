/** Where API requests go.
 *
 * The browser is served by the Margin server itself, so it uses same-origin
 * relative paths exactly as before: the base is an empty string and every URL
 * this module builds is byte-identical to the hand-written '/api'+path.
 *
 * A packaged app is served from its own origin (https://localhost on Android),
 * so relative paths would resolve to the bundle rather than the user's server.
 * It supplies an absolute base instead, and authenticates with a bearer token
 * because the SameSite=Strict session cookie cannot cross origins.
 */

/** True when running inside a Capacitor shell rather than a browser tab. */
export function isNativeClient(): boolean {
  const { Capacitor } = globalThis as { Capacitor?: { isNativePlatform?: () => boolean } };
  return Boolean(Capacitor?.isNativePlatform?.());
}

/** Accepts what a person would actually type and returns a bare origin.
 * Throws a message meant to be shown in the connection form. */
export function normalizeServerUrl(input: string): string {
  const trimmed = String(input ?? '').trim();
  if (!trimmed) throw new Error('Enter your Margin server address.');
  // Bare host or host:port is the common case. Default to https; a debug build
  // can still reach a plain http server by typing the scheme explicitly.
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : 'https://' + trimmed;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error('That is not a valid server address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Use an http:// or https:// address.');
  }
  if (!url.hostname) throw new Error('That is not a valid server address.');
  if (url.username || url.password) {
    throw new Error('Remove the username and password from the address. Margin asks for the password separately.');
  }
  if (url.search || url.hash) throw new Error('Enter only the server address, without a query or fragment.');
  if (url.pathname !== '/') {
    throw new Error('Enter only the server address. Margin does not run under a subpath.');
  }
  return url.origin;
}

/** Base for API requests. Empty string in the browser keeps same-origin behaviour. */
export function apiUrl(base: string, path: string): string {
  return (base || '') + '/api' + path;
}

/** Resolve a server-supplied address such as '/api/books/x/audio/0'.
 * Media, covers and note exports all arrive as root-relative paths. */
export function resolveServerPath(base: string, path: string): string {
  if (!base) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return base + (path.startsWith('/') ? path : '/' + path);
}

/** Headers that authenticate a native request. The browser sends its cookie
 * automatically and must not receive a token, so it adds nothing here. */
export function authHeaders(token: string | null): Record<string, string> {
  return token ? { Authorization: 'Bearer ' + token } : {};
}

export const SERVER_KEY = 'margin.server-url';
export const TOKEN_KEY = 'margin.session-token';

export type StoredConnection = { base: string; token: string | null };

/** Only a packaged app stores these; a browser never has a token to keep. */
export function savedConnection(): StoredConnection {
  try {
    return {
      base: window.localStorage.getItem(SERVER_KEY) || '',
      token: window.localStorage.getItem(TOKEN_KEY),
    };
  } catch {
    return { base: '', token: null };
  }
}

export function saveConnection(base: string, token: string | null): void {
  try {
    window.localStorage.setItem(SERVER_KEY, base);
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Staying signed in is a convenience; the app still works without storage. */
  }
}

export function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* Nothing to clear when storage is unavailable. */
  }
}
