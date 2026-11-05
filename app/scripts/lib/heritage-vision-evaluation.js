const normalize = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");

export function isVerifiedLabel(record) {
  return record?.labelStatus === "verified" && typeof record.groundTruthName === "string" && record.groundTruthName.trim().length > 0 &&
    ["place", "facility", "feature"].includes(record.groundTruthSubjectLevel) &&
    typeof record.reviewer === "string" && record.reviewer.trim().length > 0 &&
    typeof record.reviewedAt === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(record.reviewedAt) &&
    typeof record.evidence === "string" && record.evidence.trim().length > 0;
}

export function hasLivePermission(record) {
  const permission = record?.usagePermission;
  return permission?.status === "confirmed" && permission.permittedForGemini === true &&
    typeof permission.reviewer === "string" && permission.reviewer.trim().length > 0 &&
    typeof permission.reviewedAt === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(permission.reviewedAt) &&
    typeof permission.basis === "string" && permission.basis.trim().length > 0;
}

export function validateEvaluationDataset(dataset) {
  const errors = [];
  if (!dataset || dataset.schemaVersion !== 1 || !Array.isArray(dataset.images)) return ["Dataset must have schemaVersion 1 and an images array."];
  const ids = new Set();
  const imagePaths = new Set();
  for (const [index, record] of dataset.images.entries()) {
    const prefix = `images[${index}]`;
    if (!record || typeof record !== "object") { errors.push(`${prefix} must be an object.`); continue; }
    if (typeof record.imageId !== "string" || !record.imageId.trim()) errors.push(`${prefix}.imageId is required.`);
    else if (ids.has(record.imageId)) errors.push(`${prefix}.imageId is duplicated.`);
    else ids.add(record.imageId);
    if (typeof record.imagePath !== "string" || !record.imagePath.trim() || record.imagePath.startsWith("/") || record.imagePath.includes("\\") || record.imagePath.split("/").includes("..") || !record.imagePath.startsWith("images/")) {
      errors.push(`${prefix}.imagePath must be a safe relative path under images/.`);
    } else if (imagePaths.has(record.imagePath)) {
      errors.push(`${prefix}.imagePath is duplicated.`);
    } else {
      imagePaths.add(record.imagePath);
    }
    if (!["simujang", "jeongneung", "uiryeong"].includes(record.spotId)) errors.push(`${prefix}.spotId is invalid.`);
    if (typeof record.spotName !== "string" || !record.spotName.trim()) errors.push(`${prefix}.spotName is required.`);
    if (!["verified", "unverified"].includes(record.labelStatus)) errors.push(`${prefix}.labelStatus must be verified or unverified.`);
    if (record.groundTruthName !== null && typeof record.groundTruthName !== "string") errors.push(`${prefix}.groundTruthName must be a string or null.`);
    if (record.groundTruthSubjectLevel !== null && !["place", "facility", "feature"].includes(record.groundTruthSubjectLevel)) errors.push(`${prefix}.groundTruthSubjectLevel is invalid.`);
    if (record.reviewer !== null && typeof record.reviewer !== "string") errors.push(`${prefix}.reviewer must be a string or null.`);
    if (record.reviewedAt !== null && (typeof record.reviewedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(record.reviewedAt))) errors.push(`${prefix}.reviewedAt must be YYYY-MM-DD or null.`);
    if (record.evidence !== null && typeof record.evidence !== "string") errors.push(`${prefix}.evidence must be a string or null.`);
    if (!record.usagePermission || !["confirmed", "not_confirmed"].includes(record.usagePermission.status) || typeof record.usagePermission.permittedForGemini !== "boolean" ||
        (record.usagePermission.status === "not_confirmed" && record.usagePermission.permittedForGemini !== false)) errors.push(`${prefix}.usagePermission is incomplete or contradictory.`);
    if (record.labelStatus === "verified" && !isVerifiedLabel(record)) errors.push(`${prefix} is marked verified but lacks a reviewed label, reviewer, date, subject level, or evidence.`);
    if (record.usagePermission?.status === "confirmed" && !hasLivePermission(record)) errors.push(`${prefix} has an incomplete usage permission record.`);
    if (record.groundTruthAliases !== undefined && (!Array.isArray(record.groundTruthAliases) || !record.groundTruthAliases.every((alias) => typeof alias === "string" && alias.trim()))) {
      errors.push(`${prefix}.groundTruthAliases must contain non-empty reviewed strings.`);
    }
  }
  return errors;
}

function predictionMatchesName(record, prediction, officialAliases = []) {
  // Dataset labels may point to an alias, but only aliases published in the
  // existing official evidence registry are accepted for name normalization.
  const acceptedNames = [record.groundTruthName, ...officialAliases];
  const candidate = normalize(prediction?.candidateName);
  return Boolean(candidate) && acceptedNames.some((name) => normalize(name) === candidate);
}

function statusCounts(evaluated) {
  return Object.fromEntries(["identified", "uncertain", "unknown"].map((status) => {
    const rows = evaluated.filter((row) => row.prediction.identificationStatus === status);
    const correct = rows.filter((row) => row.isCorrect).length;
    return [status, { count: rows.length, correct, denominator: rows.length, accuracyPercent: rows.length ? Number((100 * correct / rows.length).toFixed(2)) : null }];
  }));
}

function accuracy(rows) {
  const correct = rows.filter((row) => row.isCorrect).length;
  return { correct, denominator: rows.length, accuracyPercent: rows.length ? Number((100 * correct / rows.length).toFixed(2)) : null };
}

export function buildEvaluationSummary({ records = [], results = [], totalDatasetImages = records.length } = {}) {
  const byId = new Map(records.map((record) => [record.imageId, record]));
  const evaluated = results.filter((row) => row.apiStatus === "success" && byId.has(row.imageId) && isVerifiedLabel(byId.get(row.imageId)));
  const errorResults = results.filter((row) => row.apiStatus === "error");
  const unverifiedCount = records.filter((record) => !isVerifiedLabel(record)).length;
  const excludedVerified = results.filter((row) => row.apiStatus === "skipped" && byId.has(row.imageId) && isVerifiedLabel(byId.get(row.imageId))).length;
  const placeRows = evaluated.filter((row) => byId.get(row.imageId).groundTruthSubjectLevel === "place");
  const facilityRows = evaluated.filter((row) => ["facility", "feature"].includes(byId.get(row.imageId).groundTruthSubjectLevel));
  const errorTypes = {};
  for (const row of results) for (const type of row.errorTypes || (row.errorType ? [row.errorType] : [])) errorTypes[type] = (errorTypes[type] || 0) + 1;
  const perSpot = {};
  for (const spotId of ["simujang", "jeongneung", "uiryeong"]) perSpot[spotId] = accuracy(evaluated.filter((row) => byId.get(row.imageId).spotId === spotId));
  return {
    totalDatasetImages,
    verifiedLabelCount: records.filter(isVerifiedLabel).length,
    unverifiedLabelCount: unverifiedCount,
    evaluatedCount: evaluated.length,
    correctCount: evaluated.filter((row) => row.isCorrect).length,
    incorrectCount: evaluated.filter((row) => !row.isCorrect).length,
    uncertainCount: evaluated.filter((row) => row.prediction.identificationStatus === "uncertain").length,
    unknownCount: evaluated.filter((row) => row.prediction.identificationStatus === "unknown").length,
    apiFailureCount: errorResults.length,
    excludedCount: unverifiedCount + excludedVerified + errorResults.length,
    overallAccuracy: accuracy(evaluated),
    placeRecognitionAccuracy: accuracy(placeRows),
    facilityRecognitionAccuracy: accuracy(facilityRows),
    identificationStatus: statusCounts(evaluated),
    perSpot,
    errorTypes,
    accuracyDefinition: "Exact normalized candidate name (canonical reviewed label or reviewed/official alias) AND exact subject level; denominator includes only verified-label records with a valid model response. API failures and unverified labels are excluded, not counted as correct.",
  };
}

export function classifyPrediction(record, prediction, { knownSpotNames = [], officialAliases = [] } = {}) {
  const nameMatch = predictionMatchesName(record, prediction, officialAliases);
  const levelMatch = prediction?.subjectLevel === record.groundTruthSubjectLevel;
  const isCorrect = nameMatch && levelMatch;
  const candidate = normalize(prediction?.candidateName);
  const isOtherPlace = knownSpotNames.some((name) => normalize(name) === candidate && normalize(name) !== normalize(record.spotName));
  let errorType = null;
  const errorTypes = [];
  if (!isCorrect) {
    if (isOtherPlace) errorType = "wrong_place";
    else if (["uncertain", "unknown"].includes(prediction?.identificationStatus)) errorType = "identification_failure";
    else if (["facility", "feature"].includes(record.groundTruthSubjectLevel) && ["place", "general"].includes(prediction?.subjectLevel) && candidate === normalize(record.spotName)) errorType = "place_only";
    else if (["facility", "feature"].includes(record.groundTruthSubjectLevel)) errorType = "wrong_facility_name";
    else errorType = "name_or_level_mismatch";
    errorTypes.push(errorType);
    if (prediction?.identificationStatus === "identified") errorTypes.push("overconfident_wrong");
  }
  return { isCorrect, errorType, errorTypes, nameMatch, levelMatch };
}

export function normalizeVisionPrediction(value) {
  if (!value || typeof value !== "object" || typeof value.candidateName !== "string" || typeof value.objectType !== "string" ||
      !Array.isArray(value.visualFeatures) || !value.visualFeatures.every((item) => typeof item === "string") ||
      !["identified", "uncertain", "unknown"].includes(value.identificationStatus) || typeof value.reason !== "string" ||
      (value.subjectLevel !== undefined && !["place", "facility", "feature", "general", "unknown"].includes(value.subjectLevel))) {
    throw Object.assign(new Error("invalid_model_response"), { code: "invalid_model_response" });
  }
  return {
    candidateName: value.candidateName.slice(0, 160),
    objectType: value.objectType.slice(0, 100),
    ...(value.subjectLevel ? { subjectLevel: value.subjectLevel } : {}),
    visualFeatures: value.visualFeatures.slice(0, 8).map((item) => item.slice(0, 180)),
    identificationStatus: value.identificationStatus,
    reason: value.reason.slice(0, 500),
  };
}

export function classifyApiFailure(error) {
  const status = Number.isInteger(error?.geminiStatus) ? error.geminiStatus : null;
  if (status === 401 || status === 403) return { status, errorType: "authentication_error" };
  if (status === 404) return { status, errorType: "model_error" };
  if (status === 429) return { status, errorType: "quota_or_rate_limit" };
  if (status === 503) return { status, errorType: "service_unavailable" };
  if (status) return { status, errorType: status >= 500 ? "upstream_error" : "request_error" };
  if (error?.code === "gemini_timeout" || error?.name === "AbortError") return { status: null, errorType: "timeout" };
  if (error?.code === "gemini_dns_error") return { status: null, errorType: "dns_error" };
  if (error?.code === "gemini_network_error" || error instanceof TypeError) return { status: null, errorType: "network_error" };
  if (error?.code === "gemini_empty_response" || error?.code === "invalid_model_response" || error instanceof SyntaxError) return { status: null, errorType: "invalid_response" };
  return { status: null, errorType: "other_error" };
}

export function createEmptySummary() {
  return buildEvaluationSummary({ records: [], results: [], totalDatasetImages: 0 });
}
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";


export async function persistEvaluationRun({ directory, metadata, results, summary, report }) {
  await mkdir(directory, { recursive: true });
  const files = [
    ["results.json", JSON.stringify({ metadata, results }, null, 2) + "\n"],
    ["summary.json", JSON.stringify(summary, null, 2) + "\n"],
    ["report.md", report],
  ];
  for (const [name, contents] of files) {
    await writeFile(path.join(directory, name), contents);
  }
}
