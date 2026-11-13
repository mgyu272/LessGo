# Less GO: offline historical narration audio

This branch uses local MP3 files **only for historical narration** in `PlaceDetail` and `Spot`. Navigation retains the existing browser TTS implementation; no navigation MP3s are needed.

Put these files in `app/public/audio/narration/`:

| Place ID | Korean | English |
| --- | --- | --- |
| simujang | simujang-ko.mp3 | simujang-en.mp3 |
| jeongneung | jeongneung-ko.mp3 | jeongneung-en.mp3 |
| uiryeong | uiryeong-ko.mp3 | uiryeong-en.mp3 |

Use the actual `spot.id` as filename stem and the exact approved story text in each language. Keep the selected Korean Kokoro voice `km_junho` and synthesis settings consistent. English voice may be a separate consistent English model.

When an MP3 is absent or fails to play, the app falls back to browser speech synthesis. No Gemini API is used for these narration plays.

**Not ready to merge:** the six approved audio assets are not yet committed, and phone playback has not been verified.

Validation before merging:
1. Add the six MP3 files to this branch.
2. Run `npm ci && npm run build` in `app/`.
3. Test Korean and English narration on both place detail and arrival screens on real mobile browsers.
4. Confirm stopping narration works, and check the browser network panel for successful MP3 requests and no `/api/tts` requests.
