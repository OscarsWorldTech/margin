import { registerPlugin } from '@capacitor/core';
import type { Player, PlayerBook, PlayerSnapshot } from './player';

/** The Android side of the player contract.
 *
 * Playback runs in a MediaSessionService rather than the WebView, because an
 * <audio> element cannot send an Authorization header and the bundle's
 * https://localhost origin blocks a plain http server as mixed content.
 * Positions crossing this boundary are always seconds from the start of the book.
 */
type NativeSnapshot = {
  bookId: string | null;
  position: number;
  duration: number;
  playing: boolean;
  buffering: boolean;
  ended: boolean;
  speed: number;
  volume: number;
  muted: boolean;
  error: string | null;
};

type MarginPlayerPlugin = {
  configure(options: { token: string | null; server: string }): Promise<void>;
  load(options: {
    bookId: string;
    title: string;
    author: string;
    position: number;
    tracks: { url: string; startOffset: number; duration: number }[];
  }): Promise<NativeSnapshot>;
  play(): Promise<NativeSnapshot>;
  pause(): Promise<NativeSnapshot>;
  seek(options: { position: number }): Promise<NativeSnapshot>;
  setSpeed(options: { speed: number }): Promise<NativeSnapshot>;
  setVolume(options: { volume: number; muted: boolean }): Promise<NativeSnapshot>;
  snapshot(): Promise<NativeSnapshot>;
  dispose(): Promise<void>;
  addListener(
    event: 'snapshot',
    listener: (snapshot: NativeSnapshot) => void,
  ): Promise<{ remove: () => Promise<void> }>;
};

const MarginPlayer = registerPlugin<MarginPlayerPlugin>('MarginPlayer');

function toSnapshot(native: NativeSnapshot): PlayerSnapshot {
  return {
    bookId: native.bookId ?? null,
    position: native.position ?? 0,
    playing: Boolean(native.playing),
    buffering: Boolean(native.buffering),
    speed: native.speed ?? 1,
    volume: native.volume ?? 1,
    muted: Boolean(native.muted),
    error: native.error ?? null,
  };
}

/** `resolve` turns a server-relative media path into an absolute address the
 * native player can fetch, and `token` authenticates those requests. */
export function createNativePlayer(
  resolve: (path: string) => string,
  token: string | null,
  server: string,
): Player {
  const configured = MarginPlayer.configure({ token, server });
  return {
    async load(book: PlayerBook, position: number) {
      await configured;
      await MarginPlayer.load({
        bookId: book.id,
        title: book.title,
        author: book.author,
        position,
        tracks: book.tracks.map(t => ({
          url: resolve(t.url),
          startOffset: t.startOffset,
          duration: t.duration,
        })),
      });
    },
    async play() {
      await MarginPlayer.play();
    },
    async pause() {
      await MarginPlayer.pause();
    },
    async seek(position: number) {
      await MarginPlayer.seek({ position });
    },
    async setSpeed(speed: number) {
      await MarginPlayer.setSpeed({ speed });
    },
    async setVolume(volume: number, muted: boolean) {
      await MarginPlayer.setVolume({ volume, muted });
    },
    async getSnapshot() {
      return toSnapshot(await MarginPlayer.snapshot());
    },
    subscribe(listener: (snapshot: PlayerSnapshot) => void) {
      const handle = MarginPlayer.addListener('snapshot', s => listener(toSnapshot(s)));
      return () => {
        void handle.then(h => h.remove());
      };
    },
    async dispose() {
      await MarginPlayer.dispose();
    },
  };
}

/** Re-authenticates media requests after a sign-in or sign-out. `server` scopes where
 * the token may be sent; the session is exported, so another app can ask this player to
 * load a URI of its choosing and must not be able to harvest the credential. */
export function configureNativePlayer(token: string | null, server: string): Promise<void> {
  return MarginPlayer.configure({ token, server });
}
