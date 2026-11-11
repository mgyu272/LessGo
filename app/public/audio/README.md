# Offline MP3 audio (work in progress)

Place audio files under `app/public/audio/`. The app attempts to play a local file first and falls back to the existing browser TTS if the file is absent or cannot play.

## Navigation files
- `navigation/start-ko.mp3`, `start-en.mp3`
- `navigation/left-ko.mp3`, `left-en.mp3`
- `navigation/right-ko.mp3`, `right-en.mp3`
- `navigation/straight-ko.mp3`, `straight-en.mp3`
- `navigation/arrive-ko.mp3`, `arrive-en.mp3`

Only messages matching the built-in phrase patterns use these fixed files. Other dynamic guidance remains browser TTS.

## Narration files
- `narration/simujang-ko.mp3`, `simujang-en.mp3`
- `narration/jeongneung-ko.mp3`, `jeongneung-en.mp3`
- `narration/uiryeong-ko.mp3`, `uiryeong-en.mp3`

The filename stem must match the actual `spot.id` in the data. Verify spelling before publishing. Files should contain the exact approved narration for the corresponding language.

## Status
The English navigation MP3 ZIP was produced locally and is provided separately in the conversation; binary files are not yet committed to this branch. Korean narration and navigation audio, and English narration audio, are **not yet produced**. Do not merge this PR until the MP3 assets have been added and mobile playback has been verified. A fallback to browser TTS does not guarantee audio on every mobile device.

## Manual verification
1. Add files under `app/public/audio/` in this branch.
2. Run `npm ci && npm run build` from `app/`.
3. Open the preview deployment on iPhone and Android. Test start, left, right, straight, arrival, each place's narration, and pause/stop.
4. Confirm there are no `/api/tts` requests during playback.
