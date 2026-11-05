// Private server-side reference lookup. Never return this module's records to clients.
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const DATASET_RELATIVE = path.join("server-data", "heritage_reference_4a");
const MAX_REFERENCE_COUNT = 3;
const MIN_REFERENCE_COUNT = 1;
const MAX_REFERENCE_BYTES = 700 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 1800 * 1024;
const MIME_EXTENSIONS = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const TYPE_ALIASES = new Map([
  ["building", "건물"], ["entrance", "입구"], ["gate", "홍살문"], ["tomb", "왕릉"],
  ["royal tomb", "왕릉"], ["tomb mound", "봉분"], ["pavilion", "정자각"],
  ["stele", "비각"], ["stonework", "석물"], ["forest path", "숲길"],
  ["library", "도서관"], ["memorial hall", "재실"], ["kitchen building", "수라간"],
  ["traditional house", "건물"], ["stone figure", "석물"], ["architectural feature", "건축 요소"],
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

function inferredSubjectLevel(record, spotName = "") {
  const name = normalize(record.objectName);
  const type = normalize(record.objectType);
  if (!name || name === normalize(spotName) || ["장소", "유적", "왕릉", "전경", "전체", "royaltomb", "heritagesite"].includes(name)) return "place";
  if (["건물", "출입구", "전시공간", "숲길", "도서관"].includes(type) && ["건물", "입구", "전체"].includes(name)) return "general";
  return "facility";
}

function nameScore(record, { candidateName, objectType, subjectLevel, spotName }) {
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
  if (["place", "facility", "feature", "general"].includes(subjectLevel)) {
    const level = inferredSubjectLevel(record, spotName);
    if (level === subjectLevel) score += 2;
    else if (level === "general" || level === "place") score -= 1;
  }
  return score;
}

export async function selectLocalReferenceImages({ spotId, spotName = "", candidateName, objectType, subjectLevel, maxCount = MAX_REFERENCE_COUNT } = {}) {
  if (typeof spotId !== "string" || !spotId || !Number.isInteger(maxCount) || maxCount < MIN_REFERENCE_COUNT) return [];
  const manifest = await loadManifest();
  if (manifest.visibility !== "private_server_side_reference" || !Array.isArray(manifest.photos)) return [];
  const matches = manifest.photos
    .filter((record) => record.spotId === spotId && record.verificationStatus === "unverified_filename_only")
    .map((record) => ({ record, score: nameScore(record, { candidateName, objectType, subjectLevel, spotName }) }))
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
        id: record.id,
        filenameCandidate: record.filename,
        objectNameCandidate: record.objectName,
        objectTypeCandidate: record.objectType,
        viewAngleCandidate: record.viewAngle,
        verificationStatus: record.verificationStatus,
        mimeType,
        bytes,
      });
      totalBytes += bytes.length;
    } catch {
      // Missing, unreadable, or invalid references are skipped; callers fall back to the user image only.
    }
  }
  return selected;
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

export function buildReferenceAssistedRequest({ spotName, spotId, lang, baseline, userImage, references, officialCandidates = [] }) {
  const system = `Compare the USER PHOTO with the SUPPORTING REFERENCE images using only visible geometry and features (roof silhouette, post arrangement, doors/windows, stone shape, background, and camera angle). The references are private supplied images with unverified filename-derived labels; neither the labels nor the references prove the user's subject identity. Do not force a match. Return comparison.status as matched only when multiple visible features correspond, mismatched only when comparable features clearly differ, otherwise inconclusive. A mismatch between photos is not proof that the user's candidate is historically wrong. Keep the baseline candidate unless the image comparison supports another name from officialCandidateNames; if you change a candidate, set identificationStatus to uncertain. A reference match must never upgrade the baseline identification status. Do not infer or invent construction dates, people, historical events, or facts. Return ${lang === "ko" ? "Korean" : "English"}.`;
  const user = [
    `Place context is a weak hint only: ${spotName} (place ID: ${spotId}).`,
    `Baseline visual candidate (not verified): ${baseline.candidateName}; object type: ${baseline.objectType}.`,
    `Baseline subject level: ${baseline.subjectLevel || "unknown"}. Official candidate names scoped to this place (names only; these records do not prove photo identity): ${JSON.stringify(officialCandidates.map((candidate) => candidate.name))}.`,
    "The first image is the USER PHOTO to identify.",
    "Each following image is a PRIVATE SUPPORTING REFERENCE. A label is derived from an unverified filename and may be wrong.",
    "Compare visible shape and features. Do not treat a label or place context as proof. Describe only observable visual features.",
    "Return the same vision fields plus comparison: {status: matched|mismatched|inconclusive, visualEvidence: string[]}. Keep user-photo observations separate from reference filename labels.",
  ].join("\n");
  const images = [
    { label: "USER PHOTO — image to identify", mimeType: userImage.mimeType, data: userImage.data },
    ...references.map((reference, index) => ({
      label: `SUPPORTING REFERENCE ${index + 1} — UNVERIFIED FILENAME/METADATA CANDIDATES: ${JSON.stringify({ filename: reference.filenameCandidate, objectName: reference.objectNameCandidate, objectType: reference.objectTypeCandidate, viewAngle: reference.viewAngleCandidate })}`,
      mimeType: reference.mimeType,
      data: reference.bytes.toString("base64"),
    })),
  ];
  return { system, user, images };
}

export function applyReferenceComparison({ baseline, assisted, status, visualEvidence = [], officialCandidates = [] }) {
  const comparisonStatus = ["matched", "mismatched", "inconclusive"].includes(status) ? status : "inconclusive";
  const sameCandidate = normalize(assisted?.candidateName) === normalize(baseline.candidateName);
  const candidateAllowed = officialCandidates.some((candidate) => [candidate.name, ...(candidate.aliases || [])].some((name) => normalize(name) === normalize(assisted?.candidateName)));
  const candidateChanged = comparisonStatus === "matched" && !sameCandidate && candidateAllowed;
  const acceptedAssistedResult = comparisonStatus === "matched" && (sameCandidate || candidateChanged);
  const result = acceptedAssistedResult ? { ...baseline, ...assisted } : { ...baseline };
  // Reference similarity is not identity proof. A changed suggestion is always downgraded.
  if (candidateChanged) result.identificationStatus = "uncertain";
  else result.identificationStatus = baseline.identificationStatus;
  return {
    result,
    comparison: {
      status: comparisonStatus,
      referenceCount: 0,
      candidateChanged,
      identificationStatusBefore: baseline.identificationStatus,
      identificationStatusAfter: result.identificationStatus,
      visualEvidence: visualEvidence.filter((item) => typeof item === "string").slice(0, 4).map((item) => item.slice(0, 200)),
    },
  };
}

export const referenceLimits = Object.freeze({ min: MIN_REFERENCE_COUNT, max: MAX_REFERENCE_COUNT, perImageBytes: MAX_REFERENCE_BYTES, totalBytes: MAX_TOTAL_REFERENCE_BYTES });
