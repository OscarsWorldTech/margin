# Proposed mobile development

Status: exploration only. No native implementation or platform commitment.

The proposed app connects to an existing Margin server. That server keeps handling
Audiobookshelf credentials, transcription, captions, and notes. A phone GPU is not
required. Potential screens: Library, Now playing, Read along, Notes, Downloads.

## First bounded milestone: playback feasibility

Choose Android or iOS based on the maintainer's actual test device. Evaluate
Capacitor to reuse the React interface, with native playback behind an explicit
player interface. Do not rewrite the whole reader or add offline sync in this step.

Acceptance criteria on a real device:

1. Connect to a test Margin server and play a sample through an authenticated path.
   Evaluate session-cookie/origin behavior and native media requests; do not assume
   the current same-origin browser API can be packaged unchanged. Keep ABS tokens
   on the server and retain existing browser authentication protections.
2. Lock the screen and switch apps; playback continues with lock-screen controls.
3. Test pause/resume from a Bluetooth headset and interruption by a call.
4. Return to the reader; captions match the actual player time, including after
   seeking, a track transition, or a speed change.
5. Existing web playback and progress tests continue to pass. Record OS/device,
   observed limitations, and a go/no-go decision before expanding scope.

## Later milestones

- Streaming app: server setup, mobile layouts, captions, note editing, progress sync,
  sleep timer, secure connection settings, and platform packaging/distribution.
- Offline: explicit downloads of audio/captions, storage management, durable note
  and position queues, stable IDs/idempotency, and a defined conflict policy. Test
  disconnected edits and reconnection before claiming offline support.

Work in independently reviewable milestones. A roadmap item does not authorize
implementation or publishing. Avoid estimates until the first device test resolves
the background-playback and authentication uncertainties.

Background references: [Capacitor](https://capacitorjs.com/docs),
[Android playback services](https://developer.android.com/media/media3/session/background-playback),
[Apple audio sessions](https://developer.apple.com/documentation/avfaudio/avaudiosession).
