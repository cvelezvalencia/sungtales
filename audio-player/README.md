# audio-player

Copies of four recordings in `audio/`, made only for the player on the story pages. The originals in `audio/` are unchanged, and **Download** on the site still gives the original.

Why: the originals are variable-bitrate (VBR) MP3s. In a VBR file a browser can only estimate where a given second is, so after a jump (▶ on a verse, tapping a verse, the progress bar, a shared verse link) the sound can be several seconds away from the time it reports, and the highlight runs a line or more off. Measured in Chrome-based Edge on 2026-11-11, jumping in the originals landed 1.9 s (Forest Man) to 9 s (Kupi) away from the reported time. In these constant-bitrate (CBR) copies the jump is exact (0.00 s).

How they were made: decoded from the originals and re-encoded with LAME 3.100 (ffmpeg 9.0.2, libmp3lame) at a constant 192 kbps, 44.1 kHz stereo, tags copied:

    ffmpeg -i "audio/<file>.mp3" -map 0:a -c:a libmp3lame -b:a 192k -ar 44100 -ac 2 -map_metadata 0 -id3v2_version 3 "audio-player/<file>.mp3"

Their timeline matches the originals sample for sample (cross-correlation offset 0.00 ms at points through each file), so the timings in `sync/` apply to both.

`Konts - Konts & Tangapa.mp3` has no copy: it is already constant-bitrate (320 kbps), and jumps in it are exact.

The story pages point to these files with `data-stream` in their custom code; `data-audio` stays the original. A new story whose MP3 is VBR needs a copy here too, made the same way.
