// Private server-side reference lookup. Never return this module's records to clients.
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const DATASET_RELATIVE = path.join("server-data", "heritage_reference_4a");
const MAX_REFERENCE_COUNT = 3;
const MIN_REFERENCE_COUNT = 2;
const MAX_REFERENCE_BYTES = 700 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 1800 * 1024;
const MIME_EXTENSIONS = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const TYPE_ALIASES = new Map([
  ["building", "건물"], ["entrance", "입구"], ["gate", "홍살문"], ["tomb", "왕릉"],
  ["royal tomb", "왕릉"], ["tomb mound", "봉분"], ["pavilion", "정자각"],
  ["stele", "비각"], ["stonework", "석물"], ["forest path", "숲길"],
  ["library", "도서관"], ["memorial hall", "재실"], ["kitchen building", "수라간"],
]);
let cachedManifest;

function normalize(value) {
  return String(value || "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function fileMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

async function loadManifest() {
  if (cachedManifest) return cachedManifest;
  const file = path.resolve(process.cwd(), DATASET_RELATIVE, "manifest.json");
  cachedManifest = JSON.parse(await readFile(file, "utf8"));
  return cachedManifest;
}

function nameScore(record, candidateName, objectType) {
  const terms = [candidateName, TYPE_ALIASES.get(String(objectType || "").toLocaleLowerCase()), objectType]
    .map(normalize).filter((value) => value.length >= 2);
  const searchable = [record.objectName, record.objectType, record.filename].map(normalize).filter(Boolean);
  let score = 0;
  const name = normalize(candidateName);
  if (name.length >= 2) {
    if (searchable.some((field) => field === name)) score += 8;
    else if (searchable.some((field) => field.includes(name) || name.includes(field))) score += 5;
  }
  for (const term of terms.slice(1)) {
    if (searchable.some((field) => field === term)) score += 3;
    else if (searchable.some((field) => field.includes(term) || term.includes(field))) score += 1;
  }
  return score;
}

export async function selectLocalReferenceImages({ spotId, candidateName, objectType, maxCount = MAX_REFERENCE_COUNT } = {}) {
  if (typeof spotId !== "string" || !spotId || !Number.isInteger(maxCount) || maxCount < MIN_REFERENCE_COUNT) return [];
  const manifest = await loadManifest();
  if (manifest.visibility !== "private_server_side_reference" || !Array.isArray(manifest.photos)) return [];
  const matches = manifest.photos
    .filter((record) => record.spotId === spotId && record.verificationStatus === "unverified_filename_only")
    .map((record) => ({ record, score: nameScore(record, candidateName, objectType) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.record.id.localeCompare(b.record.id));

  const datasetRoot = path.resolve(process.cwd(), DATASET_RELATIVE);
  const rootReal = await realpath(datasetRoot);
  const selected = [];
  let totalBytes = 0;
  for (const { record } of matches) {
    if (selected.length >= Math.min(maxCount, MAX_REFERENCE_COUNT)) break;
    if (typeof record.relativePath !== "string" || path.isAbsolute(record.relativePath) || record.relativePath.split(/[\\/]/).includes("..")) continue;
    const normalizedRelativePath = record.relativePath.replaceAll("\\", "/");
    if (!normalizedRelativePath.startsWith(`photos/${spotId}/`)) continue;
    const target = path.resolve(datasetRoot, record.relativePath);
    if (!target.startsWith(datasetRoot + path.sep)) continue;
    try {
      const actual = await realpath(target);
      if (!actual.startsWith(rootReal + path.sep)) continue;
      const info = await stat(actual);
      if (!info.isFile() || info.size > MAX_REFERENCE_BYTES || totalBytes + info.size > MAX_TOTAL_REFERENCE_BYTES) continue;
      const bytes = await readFile(actual);
      const mimeType = fileMime(bytes);
      if (!mimeType || MIME_EXTENSIONS[mimeType] !== path.extname(actual).toLowerCase() || mimeType !== record.mimeType) continue;
      selected.push({
        filenameCandidate: record.filename,
        objectNameCandidate: record.objectName,
        objectTypeCandidate: record.objectType,
        viewAngleCandidate: record.viewAngle,
        mimeType,
        bytes,
      });
      totalBytes += bytes.length;
    } catch {
      // Missing, unreadable, or invalid references are skipped; callers fall back to the user image only.
    }
  }
  return selected.length >= MIN_REFERENCE_COUNT ? selected : [];
}

export async function canSendReferencesToGemini() {
  if (process.env.GEMINI_IMAGE_REFERENCE_MODE !== "1" || process.env.GEMINI_IMAGE_REFERENCE_EXTERNAL_OK !== "1") return false;
  try {
    const manifest = await loadManifest();
    // Explicit use-specific permission is required; the current 4-A manifest has no approval and is blocked.
    return manifest.sourceArchive?.attributionStatus === "confirmed" && manifest.sourceArchive?.externalGeminiUseAllowed === true;
  } catch {
    return false;
  }
}

export function buildReferenceAssistedRequest({ spotName, spotId, lang, baseline, userImage, references }) {
  const system = `Identify only what is visually observable in the USER PHOTO. Supporting reference photos may help compare visible objects, but their filename-derived labels are unverified candidates, not ground truth. Never force a match: if the user photo does not clearly correspond to a reference, or evidence is insufficient, use identificationStatus "uncertain" or "unknown". Do not infer or invent construction dates, people, historical events, or facts. Return ${lang === "ko" ? "Korean" : "English"}.`;
  const user = [
    `Place context is a weak hint only: ${spotName} (place ID: ${spotId}).`,
    `Baseline visual candidate (not verified): ${baseline.candidateName}; object type: ${baseline.objectType}.`,
    "The first image is the USER PHOTO to identify.",
    "Each following image is a PRIVATE SUPPORTING REFERENCE. A label is derived from an unverified filename and may be wrong.",
    "Compare visible shape and features. Do not treat a label or place context as proof. Describe only observable visual features.",
  ].join("\n");
  const images = [
    { label: "USER PHOTO — image to identify", mimeType: userImage.mimeType, data: userImage.data },
    ...references.map((reference, index) => ({
      label: `SUPPORTING REFERENCE ${index + 1} — UNVERIFIED FILENAME CANDIDATE: ${reference.filenameCandidate}`,
      mimeType: reference.mimeType,
      data: reference.bytes.toString("base64"),
    })),
  ];
  return { system, user, images };
}

export const referenceLimits = Object.freeze({ min: MIN_REFERENCE_COUNT, max: MAX_REFERENCE_COUNT, perImageBytes: MAX_REFERENCE_BYTES, totalBytes: MAX_TOTAL_REFERENCE_BYTES });
