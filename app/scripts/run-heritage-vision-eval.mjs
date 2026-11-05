import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askGeminiJSON, IMAGE_MODEL, supportsImageInput, VISION_RETRY_POLICY } from "../api/_lib/gemini.js";
import { getOfficialVisualCandidates } from "../api/_lib/history-evidence.js";
import {
  buildEvaluationSummary,
  classifyApiFailure,
  classifyPrediction,
  hasLivePermission,
  isVerifiedLabel,
  normalizeVisionPrediction,
  persistEvaluationRun,
  validateEvaluationDataset,
} from "./lib/heritage-vision-evaluation.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(appRoot);
const localRoot = path.join(appRoot, ".local", "heritage_vision_eval_4a");
const datasetPath = path.join(localRoot, "dataset.json");
const examplePath = path.join(appRoot, "server-data", "heritage_vision_eval_4a", "dataset.example.json");
const outputRoot = path.join(localRoot, "runs");
const MAX_IMAGES_PER_RUN = 20;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MIME_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const SCHEMA = {
  type: "OBJECT",
  properties: {
    candidateName: { type: "STRING" },
    objectType: { type: "STRING" },
    subjectLevel: { type: "STRING", enum: ["place", "facility", "feature", "general", "unknown"] },
    visualFeatures: { type: "ARRAY", items: { type: "STRING" } },
    identificationStatus: { type: "STRING", enum: ["identified", "uncertain", "unknown"] },
    reason: { type: "STRING" },
  },
  required: ["candidateName", "objectType", "visualFeatures", "identificationStatus", "reason"],
};

function safeMime(bytes, filename) {
  const extensionMime = MIME_TYPES[path.extname(filename).toLowerCase()];
  const actualMime = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? "image/jpeg"
    : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
      : bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? "image/webp" : null;
  return extensionMime && extensionMime === actualMime ? actualMime : null;
}

function parseOptions(args) {
  if (!args.includes("--live")) throw new Error("explicit_live_mode_required");
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  if (!limitArg) throw new Error("explicit_request_limit_required");
  const limit = Number(limitArg.slice("--limit=".length));
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_IMAGES_PER_RUN) throw new Error("request_limit_out_of_range");
  return { limit };
}

async function readDataset() {
  try { return JSON.parse(await readFile(datasetPath, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return JSON.parse(await readFile(examplePath, "utf8"));
    throw error;
  }
}

async function loadLocalPhoto(record) {
  const imagesRoot = path.join(localRoot, "images");
  let bytes;
  let fileReal;
  try {
    const imagesRootReal = await realpath(imagesRoot);
    const filePath = path.resolve(localRoot, record.imagePath.replaceAll("/", path.sep));
    fileReal = await realpath(filePath);
    if (!fileReal.startsWith(imagesRootReal + path.sep)) throw Object.assign(new Error("unsafe_image_path"), { code: "unsafe_image_path" });
    if ((await stat(fileReal)).size > MAX_IMAGE_BYTES) throw Object.assign(new Error("image_size_limit"), { code: "image_size_limit" });
    bytes = await readFile(fileReal);
  } catch (error) {
    if (error.code === "unsafe_image_path") throw error;
    throw Object.assign(new Error("image_file_unavailable"), { code: "image_file_unavailable" });
  }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw Object.assign(new Error("image_size_limit"), { code: "image_size_limit" });
  const mimeType = safeMime(bytes, fileReal);
  if (!mimeType) throw Object.assign(new Error("unsupported_or_mismatched_image_type"), { code: "unsupported_or_mismatched_image_type" });
  return { bytes, mimeType };
}

async function getNameContext(record) {
  const official = await getOfficialVisualCandidates(record.spotId);
  const officialData = JSON.parse(await readFile(path.join(appRoot, "server-data", "heritage_evidence_4d.json"), "utf8"));
  const truthNames = new Set([record.groundTruthName, ...(record.groundTruthAliases || [])].map((name) => String(name || "").normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "")));
  const officialAliases = officialData.objects.filter((entry) => entry.spotId === record.spotId && entry.verificationStatus === "official_verified" &&
    [entry.objectName, ...(entry.aliases || [])].some((name) => truthNames.has(String(name).normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ""))))
    .flatMap((entry) => [entry.objectName, ...(entry.aliases || [])]);
  return { official, officialAliases };
}

function buildPrompt(record, officialCandidates) {
  const spotName = record.spotName;
  const system = `Identify the main subject visibly centered or most prominent in the supplied image. Distinguish a whole heritage place from an individual facility (such as a hall or gate) and from a smaller architectural feature. Use a specific facility name only when the image itself provides enough visible evidence; otherwise use a broad object category or the place level. The place context and the supplied candidate vocabulary are weak hints, never proof; candidates may be absent from the photo. Do not force a match. Do not infer or invent construction dates, people, historical events, or other historical facts. If uncertain, use identificationStatus "uncertain"; if no defensible candidate can be named, use "unknown". Set subjectLevel to place, facility, feature, general, or unknown according to the specificity of the visual candidate. Return ${"Korean"}. In English, use these consistent names when relevant: Simujang, Jeongneung Royal Tomb, Uireung Royal Tomb, Jeongjagak, Hongsalmun, and Queen Sindeok.`;
  const user = `Possible location context (weak hint only): ${spotName} (place ID: ${record.spotId}). Possible names of facilities recorded for this place (suggestions only; do not assume any is visible): ${JSON.stringify(officialCandidates)}. Identify the most prominent visible subject and list concrete visual clues supporting the candidate. Do not claim historical facts that cannot be seen in the photo.`;
  return { system, user };
}

function makeReport({ runId, metadata, summary, results, interrupted }) {
  const pct = (value) => value.accuracyPercent === null ? "not available (no evaluated samples)" : `${value.accuracyPercent}% (${value.correct}/${value.denominator})`;
  return [
    "# Less GO heritage Vision evaluation",
    "",
    `- Run: ${runId}`,
    `- Mode: ${metadata.mode}`,
    `- Model: ${metadata.model}`,
    `- Reference-photo comparison: disabled` ,
    `- Interrupted: ${interrupted ? "yes (completed results preserved)" : "no"}`,
    `- Requests started: ${metadata.requestsStarted}`,
    `- Accuracy denominator: ${summary.evaluatedCount}`,
    "",
    "## Metrics",
    "",
    `- Overall exact recognition: ${pct(summary.overallAccuracy)}`,
    `- Place-level recognition: ${pct(summary.placeRecognitionAccuracy)}`,
    `- Individual facility/feature recognition: ${pct(summary.facilityRecognitionAccuracy)}`,
    `- Correct / incorrect: ${summary.correctCount} / ${summary.incorrectCount}`,
    `- Uncertain / unknown among evaluated responses: ${summary.uncertainCount} / ${summary.unknownCount}`,
    `- API failures (excluded from accuracy denominator): ${summary.apiFailureCount}`,
    `- Excluded labels or requests: ${summary.excludedCount}`,
    "",
    "## Error types",
    "",
    ...Object.entries(summary.errorTypes).map(([type, count]) => `- ${type}: ${count}`),
    ...(Object.keys(summary.errorTypes).length ? [] : ["- No errors recorded."]),
    "",
    "## Method",
    "",
    summary.accuracyDefinition,
    "",
    "This report evaluates dataset labels and does not represent per-photo confidence. API errors are excluded, not counted as correct. No reference photos were submitted.",
    "",
    `Completed result rows: ${results.length}`,
    "",
  ].join("\n");
}

async function main() {
  let options;
  try { options = parseOptions(process.argv.slice(2)); }
  catch (error) {
    console.error(error.message === "explicit_live_mode_required"
      ? "No Gemini request started. Use an explicit --live --limit=N command to opt in."
      : "A limit from 1 to 20 is required (for example --live --limit=1). No request was sent.");
    process.exitCode = 2;
    return;
  }
  const dataset = await readDataset();
  const validationErrors = validateEvaluationDataset(dataset);
  if (validationErrors.length) {
    console.error(`Dataset invalid (${validationErrors.length} issue(s)); no Gemini request was sent.`);
    process.exitCode = 1;
    return;
  }
  if (!dataset.images.length) {
    console.log("No photos are registered. No Gemini request was sent; accuracy metrics remain unavailable.");
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not configured. No Gemini request was sent.");
    process.exitCode = 1;
    return;
  }
  const model = IMAGE_MODEL();
  if (!supportsImageInput(model)) {
    console.error("The configured image model is not enabled for this Vision evaluator. No Gemini request was sent.");
    process.exitCode = 1;
    return;
  }
  const spotsData = JSON.parse(await readFile(path.join(appRoot, "public", "data", "spots.json"), "utf8"));
  const knownSpotNames = spotsData.spots.flatMap((spot) => [spot.name.ko, spot.name.en]);
  const records = dataset.images;
  const eligible = records.filter((record) => isVerifiedLabel(record) && hasLivePermission(record)).slice(0, options.limit);
  const skipped = records.filter((record) => !eligible.includes(record));
  const runId = new Date().toISOString().replaceAll(":", "-");
  const runDirectory = path.join(outputRoot, runId);
  const results = skipped.map((record) => ({ imageId: record.imageId, apiStatus: "skipped", errorType: isVerifiedLabel(record) ? "usage_permission_not_confirmed" : "label_unverified" }));
  let interrupted = false;
  let requestsStarted = 0;
  process.on("SIGINT", () => { interrupted = true; console.warn("Stop requested. The current request will finish, then completed results will be saved."); });
  const metadata = { mode: "gemini_only", model, promptVersion: "lessgo-vision-eval-4a-v1", startedAt: new Date().toISOString(), requestsStarted, referencePhotoComparison: false };
  const persist = async () => {
    metadata.requestsStarted = requestsStarted;
    const summary = buildEvaluationSummary({ records, results, totalDatasetImages: records.length });
    await persistEvaluationRun({ directory: runDirectory, metadata, results, summary, report: makeReport({ runId, metadata, summary, results, interrupted }) });
  };
  await persist();
  if (skipped.length) console.log(`${skipped.length} record(s) skipped because labels or Gemini usage permission are not confirmed.`);
  console.log(`Eligible photo count: ${eligible.length}; request cap: ${options.limit}; maximum actual Gemini calls: ${eligible.length}.`);
  for (const record of eligible) {
    if (interrupted) break;
    const startedAt = Date.now();
    let httpStatus = null;
    try {
      const { bytes, mimeType } = await loadLocalPhoto(record);
      const { official, officialAliases } = await getNameContext(record);
      const prompt = buildPrompt(record, official);
      requestsStarted++;
      const originalFetch = globalThis.fetch;
      let raw;
      globalThis.fetch = async (...args) => {
        const response = await originalFetch(...args);
        httpStatus = response.status;
        return response;
      };
      try {
        raw = await askGeminiJSON({
          ...prompt,
          schema: SCHEMA,
          model,
          phase: "vision_eval",
          timeoutMs: VISION_RETRY_POLICY.attemptTimeoutMs,
          maxAttempts: 1,
          retryStatuses: [],
          image: { mimeType, data: bytes.toString("base64") },
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      const prediction = normalizeVisionPrediction(raw);
      const match = classifyPrediction(record, prediction, { knownSpotNames, officialAliases });
      results.push({
        imageId: record.imageId,
        apiStatus: "success",
        httpStatus,
        elapsedMs: Date.now() - startedAt,
        prediction,
        isCorrect: match.isCorrect,
        errorType: match.errorType,
        errorTypes: match.errorTypes,
      });
      console.log(`${record.imageId}: Gemini response received; evaluation recorded.`);
    } catch (error) {
      const failure = classifyApiFailure(error);
      const localError = ["unsupported_or_mismatched_image_type", "image_size_limit", "unsafe_image_path", "image_file_unavailable"].includes(error.code);
      results.push({ imageId: record.imageId, apiStatus: localError ? "skipped" : "error",
        elapsedMs: Date.now() - startedAt, httpStatus: httpStatus ?? failure.status, errorType: localError ? error.code : failure.errorType });
      console.warn(`${record.imageId}: ${results.at(-1).apiStatus}; type=${results.at(-1).errorType}${failure.status ? `; HTTP ${failure.status}` : ""}.`);
    }
    await persist();
  }
  metadata.completedAt = new Date().toISOString();
  await persist();
  const summary = buildEvaluationSummary({ records, results, totalDatasetImages: records.length });
  console.log(`Run saved locally. Evaluated=${summary.evaluatedCount}; API failures=${summary.apiFailureCount}; overall accuracy=${summary.overallAccuracy.accuracyPercent === null ? "not available" : `${summary.overallAccuracy.accuracyPercent}%`}.`);
  console.log("Output is under the ignored local evaluation folder; image paths, keys, and image data were not printed.");
}

await main();
