# Ebook folder and built-in alignment

Margin can pair a normal EPUB with an Audiobookshelf recording and produce
read-along passages without Storyteller. This is included in **v0.1.6 and newer**
images. Upgrade older installations before following this guide. An aligned Storyteller EPUB remains
another option; see [Storyteller import](STORYTELLER.md).

## Connect an ebook folder

Your EPUB folder must be accessible to the **Docker host**. For a NAS, mount the
share on that host first. Margin cannot read a folder on another computer merely
from a browser path. Keep Audiobookshelf's audio configuration as it is.

In the directory holding your existing Margin Compose configuration:

1. Add the existing EPUB folder's absolute host path to `.env`:

   ```dotenv
   EBOOK_DIRECTORY=/srv/media/ebooks
   ```

2. Place the supplied `compose.ebooks.yml` beside your existing Compose file.
3. Start Margin with your **existing file and project name**, adding this overlay:

   ```sh
   docker compose -f compose.yml -f compose.ebooks.yml up -d
   ```

   Replace `compose.yml` with the filename you already use. The supplied all-in-one
   files are `compose.aio.cpu.yml`, `compose.aio.intel.yml` and
   `compose.aio.nvidia.yml`. Retain any existing `-p PROJECT` option. Do not switch to a
   different hardware profile or create a new project/volume as part of this step.
   Use both `-f` arguments for subsequent updates as well. This file is an optional
   overlay; the ordinary hardware profiles are still complete alternatives.

The overlay adds a **read-only** `/books` mount and sets `EBOOK_DIR=/books` inside
the container. It refuses to silently create a missing host directory. The
container user must have permission to read files and traverse folders. Margin
does not rename, modify or delete your EPUBs. Do not mount your entire host root.

If you prefer editing your existing Compose file directly, add `EBOOK_DIR: /books`
to `services.margin.environment` and add the read-only bind mount shown in
`compose.ebooks.yml` to that service's existing volumes list. Preserve `/data`,
`/models`, ports and device settings.

For a source install outside Docker, set `EBOOK_DIR` to the local ebook directory
before starting the server. Install dependencies with `npm ci --ignore-scripts`.
The server now uses the pinned ZIP/XML parsers included in the supplied images.

## Pair, align and review

1. Open an audiobook in Margin and select **Pair ebook from folder**.
2. Choose **Scan ebook folder**. Margin scans subdirectories for `.epub` files.
3. Search by title, author or filename. Suggestions use filenames, so inspect the
   selected ebook's metadata and sample before confirming the edition.
4. Select **Align this ebook**. Margin reuses completed captions, including imported
   SRT/VTT. If captions are missing or incomplete, it starts or resumes the existing
   Whisper job with your configured CPU/GPU backend and language.
5. Leave the page if needed; the server continues processing. After a server restart,
   choose **Resume ebook alignment**. Finished audio chunks are retained. Text
   matching itself restarts, while a completed review survives a restart.
6. Select **Review aligned text** when ready. Check coverage and listen to samples
   from the beginning, middle and end. Unmatched passages are listed separately and
   omitted from the timed reader. A failed alignment leaves your current text alone.
7. Confirm the timing and select **Use aligned book text**. Only then does it replace
   any previously activated book text. Existing saved notes and captions are kept.

Use **Book text** or **Audio captions** to choose what to read. The same playback,
progress sync, passage selection, notes and exports remain available. Selecting a
different source resets the session text delay and clears unsaved selections/drafts.

## How accurate is it?

This first version uses **transcript-assisted text matching**, not a separate
acoustic forced-alignment model. It finds ebook sentences in caption words using
local and indexed fuzzy matching. Word positions are estimated within each caption
segment, so sentence times are approximate. Displayed wording comes from the EPUB.

Matching is chronological. Different editions, reordered or omitted chapters,
narrator additions, badly transcribed names and number formatting can reduce
coverage. Very short or unusually long sentences may be omitted. Uncertain matches
are not filled with invented timings. Coverage describes the fraction of passages
matched, **not an accuracy guarantee**. Check later passages for drift before use.
The matcher is best suited to languages whose words are separated by spaces. Set
`WHISPER_LANGUAGE` appropriately for the recording before generating captions.

This release reads timed plain-text passages, not full ebook typography/images,
and does not export a new aligned EPUB or automatically watch folders. Scan again
after adding or removing files. There is no cloud transcription or Storyteller
dependency; GPU support comes from Margin's existing Whisper configuration.

## Limits and troubleshooting

- Scans are bounded to 20,000 filesystem entries, 5,000 EPUBs and 12 nested levels.
  Use a smaller mounted folder if those limits are exceeded. Symlinks and junctions
  beneath the configured folder are skipped; files are checked again before reading.
- Each EPUB is limited to 512 MiB, 20,000 ZIP entries, 4 MiB per XML document,
  32 MiB of XML reads, 5 MiB of sentence text and 50,000 passages. Alignment supports
  up to 400,000 caption words and 120 words per matched sentence. At most 20 books
  can await alignment, with text jobs processed one at a time.
- Use unencrypted EPUBs. Standard IDPF font obfuscation is allowed because fonts
  are ignored. Standard XHTML external doctypes are stripped without fetching a
  DTD; named characters such as `&nbsp;` use the parser's built-in character table.
  DRM, internal DTD subsets/custom entities, xml:base and external document references
  are unsupported. Text parsing happens in a memory-limited worker with a timeout;
  archive contents are never extracted onto the server filesystem or rendered as HTML.
- If matching fails, confirm the edition and language, check caption quality, and
  retry with the correct EPUB. Existing Storyteller imports remain available when
  you already have more precise alignment.
