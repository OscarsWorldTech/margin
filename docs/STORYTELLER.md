# Read along with Storyteller book text

Margin can import timed passages from an **aligned readaloud EPUB** exported by
[Storyteller](https://storyteller-platform.dev/docs/managing/aligning/). This feature
is included in v0.1.6 and newer images. Upgrade older installations first.

You need the aligned EPUB and the **same audiobook edition** in Audiobookshelf.
A normal EPUB has no audio timings and cannot be imported this way. For a normal EPUB, use [built-in ebook alignment](EBOOKS.md) instead.

1. In Storyteller, finish aligning your ebook and audiobook, then download the
   resulting readaloud EPUB.
2. Open the matching audiobook in Margin and choose **Import Storyteller EPUB**.
3. Select the EPUB. Margin reads its text and timing files on your device. Its
   embedded audiobook is neither uploaded nor used for playback.
4. Review each audio file's **Starts in audiobook (seconds)** value. This is the
   time on the entire Audiobookshelf book timeline where that EPUB audio file
   begins, not the first spoken sentence's time. When track counts match, Margin
   suggests Audiobookshelf track offsets in order. Otherwise, if chapter counts
   match, it suggests chapter starting times. One EPUB audio file starts with
   a suggestion of zero. Suggestions do not verify that recordings match.
5. Use **Listen to first passage** to check the displayed text against the audio.
   Also check later passages after saving. Different chapter splits require manual
   starting times; adding up last-passage times is unreliable because silence may
   follow a passage. If the recording or edition differs, align the correct pair
   in Storyteller instead.
6. Confirm the recording and timings match, then choose **Save book text**.

Use **Book text** and **Audio captions** to switch reading sources. Playback keeps
its position. Search, automatic following, timestamp playback, highlighting and
notes work with either source. Switching sources clears an unsaved passage
selection/draft and resets the session text delay to zero. Saved notes retain their
original quotations and timestamps; they are not rewritten when you import again.
Importing again replaces only the previous book-text import. Generated/imported
captions and transcription checkpoints remain intact.

## What is supported

- EPUB 3 Media Overlays: OPF spine and media-overlay references, SMIL text/audio
  pairs, element IDs, and explicit clip end times.
- Multiple audio files mapped onto Margin's existing book-wide timeline.
- Plain text from timed elements, with original wording and punctuation. Book
  formatting, images, untimed sections, and a paginated ebook reader are not part
  of this first version. The preview reports sections without media overlays.
- Existing local GPU/CPU transcription is still available when no aligned EPUB
  exists. Importing a prepared EPUB itself needs no GPU or Whisper run.

## Limits and troubleshooting

The local import accepts archives up to 4 GiB, 20,000 archive entries, 50,000
passages and 2,000 referenced audio files. Each XML document is limited to 4 MiB
and total XML reads to 32 MiB. The server accepts up to 8 MiB of extracted JSON.
Very large books may exceed these limits. Password-protected files, DRM, custom
DTDs/entities, xml:base, external references, missing text/audio, and unsupported
overlays are rejected. Export an unencrypted EPUB with standard Media Overlays.

Overlapping or out-of-range mapped passages are rejected before replacing any
saved import. These checks catch invalid mappings; they cannot prove that an
edition matches. For drifting timing, check that the recordings match before
using the small session-only **Text delay** adjustment in settings.

Only plain text and timestamps are saved to Margin. Ebook markup and scripts are
never rendered and referenced network resources are never fetched. Existing server
authentication and origin checks protect the import endpoint.
