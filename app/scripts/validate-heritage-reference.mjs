import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.resolve(process.argv[2] || path.join(appRoot, "server-data", "heritage_reference_4a", "manifest.json"));
const datasetRoot = path.dirname(manifestPath);
const required = ["id", "spotId", "spotName", "filename", "relativePath", "objectName", "objectType", "viewAngle", "source", "verificationStatus"];
const expectedMime = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const errors = [];

function detectedMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

try {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const spotData = JSON.parse(await readFile(path.join(appRoot, "public", "data", "spots.json"), "utf8"));
  const spots = new Map(spotData.spots.map((spot) => [spot.id, spot]));
  if (!Array.isArray(manifest.photos)) throw new Error("manifest.photos must be an array");
  if (path.relative(appRoot, datasetRoot).split(path.sep)[0] === "public") errors.push("Reference dataset must not be inside public/.");

  const ids = new Set();
  const paths = new Set();
  const hashes = new Map();
  const counts = new Map();
  for (const [index, photo] of manifest.photos.entries()) {
    const prefix = `photos[${index}]`;
    for (const key of required) if (!Object.hasOwn(photo, key)) errors.push(`${prefix}: missing field '${key}'`);
    if (ids.has(photo.id)) errors.push(`${prefix}: duplicate ID '${photo.id}'`);
    ids.add(photo.id);
    if (!spots.has(photo.spotId)) errors.push(`${prefix}: unknown spotId '${photo.spotId}'`);
    else if (photo.spotName !== spots.get(photo.spotId).name.ko) errors.push(`${prefix}: spotName does not match spots.json for '${photo.spotId}'`);
    if (photo.objectName !== null && typeof photo.objectName !== "string") errors.push(`${prefix}: objectName must be a string or null`);
    if (photo.objectType !== null && typeof photo.objectType !== "string") errors.push(`${prefix}: objectType must be a string or null`);
    if (photo.viewAngle !== null && typeof photo.viewAngle !== "string") errors.push(`${prefix}: viewAngle must be a string or null`);
    if (typeof photo.source !== "string" || !photo.source.trim()) errors.push(`${prefix}: source must be a non-empty string`);
    if (photo.verificationStatus !== "unverified_filename_only") errors.push(`${prefix}: filename-derived entries must remain unverified`);
    if (photo.identityReview?.status !== "unverified_filename_only" || photo.identityReview?.reviewer !== null || photo.identityReview?.reviewedAt !== null || photo.identityReview?.basis !== null) {
      errors.push(`${prefix}: identity review must remain unresolved until a human review is recorded`);
    }
    if (photo.externalUseReview?.status !== "not_confirmed" || photo.externalUseReview?.externalGeminiUseAllowed !== false || photo.externalUseReview?.reviewer !== null || photo.externalUseReview?.reviewedAt !== null || photo.externalUseReview?.basis !== null) {
      errors.push(`${prefix}: external Gemini use must remain blocked until rights are documented`);
    }
    if (typeof photo.relativePath !== "string" || path.isAbsolute(photo.relativePath) || photo.relativePath.split(/[\\/]/).includes("..")) {
      errors.push(`${prefix}: unsafe relativePath '${photo.relativePath}'`);
      continue;
    }
    const relativePath = photo.relativePath.replaceAll("/", path.sep);
    if (paths.has(relativePath)) errors.push(`${prefix}: duplicate relativePath '${photo.relativePath}'`);
    paths.add(relativePath);
    const lexicalTarget = path.resolve(datasetRoot, relativePath);
    if (!lexicalTarget.startsWith(datasetRoot + path.sep)) {
      errors.push(`${prefix}: path escapes dataset root`);
      continue;
    }
    try {
      const [resolvedTarget, rootReal] = await Promise.all([realpath(lexicalTarget), realpath(datasetRoot)]);
      if (!resolvedTarget.startsWith(rootReal + path.sep)) {
        errors.push(`${prefix}: resolved path escapes dataset root`);
        continue;
      }
      const info = await stat(resolvedTarget);
      if (!info.isFile()) { errors.push(`${prefix}: path is not a file`); continue; }
      const bytes = await readFile(resolvedTarget);
      const extensionMime = expectedMime[path.extname(photo.filename).toLowerCase()];
      const actualMime = detectedMime(bytes);
      if (!extensionMime) errors.push(`${prefix}: unsupported extension '${path.extname(photo.filename)}'`);
      if (actualMime !== extensionMime || photo.mimeType !== actualMime) errors.push(`${prefix}: image format mismatch (extension=${extensionMime}, content=${actualMime}, manifest=${photo.mimeType})`);
      if (photo.sizeBytes !== bytes.length) errors.push(`${prefix}: sizeBytes mismatch`);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (photo.sha256 && photo.sha256 !== hash) errors.push(`${prefix}: sha256 mismatch`);
      if (hashes.has(hash)) errors.push(`${prefix}: duplicate image content with '${hashes.get(hash)}'`);
      else hashes.set(hash, photo.id);
      counts.set(photo.spotId, (counts.get(photo.spotId) || 0) + 1);
    } catch {
      errors.push(`${prefix}: missing or unreadable file '${photo.relativePath}'`);
    }
  }
  if (manifest.sourceArchive?.attributionStatus !== "unknown" || manifest.sourceArchive?.publicationAllowed !== false || manifest.sourceArchive?.externalGeminiUseAllowed !== false) {
    errors.push("Source attribution/publication status must remain unresolved and not allowed.");
  }
  if (errors.length) {
    console.error(`Validation failed with ${errors.length} issue(s):`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
  } else {
    console.log(`Validated ${manifest.photos.length} photo records; no missing fields, path errors, duplicate files, or image-format errors.`);
    for (const [spotId, count] of [...counts].sort(([a], [b]) => a.localeCompare(b))) console.log(`${spotId}: ${count}`);
    console.log(`Attribution status: ${manifest.sourceArchive.attributionStatus}; publication allowed: ${manifest.sourceArchive.publicationAllowed}`);
  }
} catch (error) {
  console.error(`Could not validate manifest: ${error.message}`);
  process.exitCode = 1;
}
