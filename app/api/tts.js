// Server-side Gemini TTS: API key is never exposed to the browser.
const MODEL = process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts";
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
  const { text, lang = "ko", purpose = "history" } = req.body || {};
  if (typeof text !== "string" || !text.trim() || text.length > 4000 || !["ko", "en"].includes(lang) || !["navigation", "history"].includes(purpose))
    return res.status(400).json({ error: "Invalid TTS request" });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: "Gemini is not configured" });
  const instruction = purpose === "navigation"
    ? "Speak clearly, brightly, and concisely like a friendly female running navigation guide."
    : "Speak warmly and naturally like a friendly female cultural heritage tour guide.";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${instruction} Read the following ${lang === "ko" ? "Korean" : "English"} text exactly without adding content:\n${text}` }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } },
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const details = (await upstream.text()).slice(0, 1200);
      console.error("[Gemini TTS] upstream error", { status: upstream.status, details });
      return res.status(502).json({ error: "Gemini TTS request failed", upstreamStatus: upstream.status });
    }
    const result = await upstream.json();
    const part = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
    if (!part) { console.error("[Gemini TTS] response contained no audio", { candidateCount: result.candidates?.length ?? 0 }); return res.status(502).json({ error: "Gemini returned no audio" }); }
    const pcm = Buffer.from(part.inlineData.data, "base64");
    // Gemini TTS emits raw 16-bit mono PCM at 24 kHz.
    const wav = Buffer.alloc(44 + pcm.length);
    wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24000, 24); wav.writeUInt32LE(48000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(wav);
  } catch (error) {
    const timeout = controller.signal.aborted;
    console.error("[Gemini TTS] request failed", { type: timeout ? "timeout" : (error?.name || "unknown"), message: String(error?.message || "").slice(0, 300) });
    return res.status(502).json({ error: timeout ? "Gemini TTS timed out" : "Gemini TTS unavailable" });
  } finally { clearTimeout(timer); }
}
