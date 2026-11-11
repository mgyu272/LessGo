// Run from app/: GEMINI_API_KEY=... node scripts/generate-narration-audio.mjs
// Generates fixed Gemini voice files once, never exposing the API key to the browser.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const key = process.env.GEMINI_API_KEY;
if (!key) throw new Error("Set GEMINI_API_KEY locally or as a GitHub Actions secret.");
const model = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const data = JSON.parse(await readFile("public/data/spots.json", "utf8"));
const ids = new Set(["simujang", "jeongneung", "uiryeong"]);
const output = "public/audio/narrations";
await mkdir(output, { recursive: true });
const manifest = { ko: {}, en: {} };
for (const spot of data.spots) {
  if (!ids.has(spot.id)) continue;
  for (const lang of ["ko", "en"]) {
    const text = spot.narration?.[lang]?.trim();
    if (!text) continue;
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);
    const filename = spot.id + "-" + lang + "-" + hash + ".wav";
    console.log("Generating", filename);
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: "Speak warmly and naturally like a friendly female cultural heritage tour guide. Read the following " + (lang === "ko" ? "Korean" : "English") + " text exactly without adding content:\\n" + text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } },
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!response.ok) throw new Error(filename + " Gemini HTTP " + response.status + " " + (await response.text()).slice(0, 400));
    const result = await response.json();
    const part = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
    if (!part) throw new Error("No audio returned for " + filename);
    const pcm = Buffer.from(part.inlineData.data, "base64");
    const wav = Buffer.alloc(44 + pcm.length);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
    await writeFile(path.join(output, filename), wav);
    manifest[lang][text] = filename;
  }
}
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("Done. Commit public/audio/narrations/ to deploy pre-generated audio.");
