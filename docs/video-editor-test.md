# Video editor manual test checklist

Run these checks on Android and iOS development builds. The editor uses native video export and is not available in Expo Go or the web app.

- [ ] Select a 3-minute video. Confirm the editor opens with a maximum-length window, the window can slide across the whole source, and the selected length never exceeds the destination limit.
- [ ] Select a 200 MB video. Confirm export attempts a lower bitrate/resolution and either produces an output under the destination size cap or gives a clear size error without losing the selected trim range.
- [ ] Test portrait and landscape clips. Confirm preview, thumbnail strip, trim handles, and playback are usable in portrait and on a tablet.
- [ ] Drag both trim handles and the selected window. Confirm the clip cannot be shorter than 1 second and preview playback loops inside the selected range.
- [ ] Toggle mute and confirm the resulting MP4 has no audio.
- [ ] Cancel during export. The editor should close and never return an output file to the caller. The current native trim/compress API cannot interrupt work already underway; it deletes the generated output after that call finishes.
- [ ] Kill the app during a feed upload, relaunch it, and confirm the existing resumable upload resumes; confirm its local edited file is removed after completion or discard.
- [ ] Create two post drafts with different captions, hashtags, audiences, and comment/caption toggles. Confirm both appear in Drafts with a thumbnail, duration, and last-edited time.
- [ ] Close the composer with Keep draft, relaunch it, and resume each draft. Confirm its video, caption, audience, toggles, and trim/mute settings are restored.
- [ ] Discard one draft and confirm only its local video file is deleted; post another and confirm its draft record is cleared while the resumable upload remains intact.
- [ ] Confirm the composer explains drafts are stored on this device only and that drafts do not appear on a second device.
- [ ] Test feed (60 seconds / 50 MiB), chat (60 seconds / 25 MiB), community (60 seconds / 50 MiB), and story (15 seconds / 25 MiB) limits independently.
- [ ] Verify picker videos with missing MIME metadata and QuickTime sources export as `video/mp4`.
- [ ] Crop-to-1:1, other crop presets, text, and drawing are intentionally not testable: they are not implemented because the selected headless engine does not expose those transforms.
