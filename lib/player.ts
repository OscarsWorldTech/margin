/** Shared contract for future browser and native playback implementations.
 * Positions are seconds from the start of the whole book, not the current track.
 * This contract is not yet wired to the reader or implemented by a native plugin.
 */
export type PlayerTrack = {
  url: string;
  startOffset: number;
  duration: number;
};

export type PlayerBook = {
  id: string;
  title: string;
  author: string;
  duration: number;
  tracks: PlayerTrack[];
};

export type PlayerSnapshot = {
  bookId: string | null;
  position: number;
  playing: boolean;
  buffering: boolean;
  speed: number;
  volume: number;
  muted: boolean;
  error: string | null;
};

export interface Player {
  /** Load paused. Reject on failure; never silently start a different book. */
  load(book: PlayerBook, position: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(position: number): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  /** Volume is 0..1. Neither volume nor speed changes may seek. */
  setVolume(volume: number, muted: boolean): Promise<void>;
  /** Read actual player time on app resume before updating captions/progress. */
  getSnapshot(): Promise<PlayerSnapshot>;
  /** Includes OS/headset changes. Returns the listener cleanup function. */
  subscribe(listener: (snapshot: PlayerSnapshot) => void): () => void;
  dispose(): Promise<void>;
}
