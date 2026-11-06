import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvaluationDataset } from "./lib/heritage-vision-evaluation.js";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localRoot = path.join(appRoot, ".local", "heritage_vision_eval_4a");
const localDataset = path.join(localRoot, "dataset.json");
const template = path.join(appRoot, "server-data", "heritage_vision_eval_4a", "dataset.example.json");
const datasetPath = process.argv[2] ? path.resolve(process.argv[2]) : localDataset;
const errors = [];
const allowedMime = new Set(["image/jpeg", "image/png", "image/webp"]);
const contentHashes = new Map();

function mimeFromBytes(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

try {
  let dataset;
  try { dataset = JSON.parse(await readFile(datasetPath, "utf8")); }
  catch (error) {
    if (!process.argv[2] && error.code === "ENOENT") dataset = JSON.parse(await readFile(template, "utf8"));
    else throw error;
  }
  errors.push(...validateEvaluationDataset(dataset));
  const spotData = JSON.parse(await readFile(path.join(appRoot, "public", "data", "spots.json"), "utf8"));
  const spots = new Map(spotData.spots.map((spot) => [spot.id, spot]));
  const datasetRoot = path.dirname(datasetPath);
  let rootReal = null;
  try { rootReal = await realpath(datasetRoot); } catch {}
  for (const [index, record] of (dataset.images || []).entries()) {
    const prefix = `images[${index}]`;
    const spot = spots.get(record.spotId);
    if (spot && record.spotName !== spot.name.ko) errors.push(`${prefix}.spotName does not match the saved place ID.`);
    if (typeof record.imagePath !== "string" || record.imagePath.startsWith("/") || record.imagePath.includes("\\") || record.imagePath.split("/").includes("..")) continue;
    const imagePath = path.resolve(datasetRoot, record.imagePath.replaceAll("/", path.sep));
    if (!imagePath.startsWith(datasetRoot + path.sep)) { errors.push(`${prefix}.imagePath escapes its dataset directory.`); continue; }
    try {
      const [resolved, info] = await Promise.all([realpath(imagePath), stat(imagePath)]);
      if (rootReal && !resolved.startsWith(rootReal + path.sep)) { errors.push(`${prefix}.imagePath resolves outside the dataset directory.`); continue; }
      if (!info.isFile()) { errors.push(`${prefix}.imagePath is not a file.`); continue; }
      if (info.size > 3 * 1024 * 1024) { errors.push(`${prefix} image exceeds the 3 MB limit.`); continue; }
      const ext = path.extname(imagePath).toLowerCase();
      const expected = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : null;
      const bytes = await readFile(imagePath);
      const actual = mimeFromBytes(bytes);
      if (!expected || !allowedMime.has(actual) || actual !== expected) errors.push(`${prefix} image extension and content type do not match supported JPEG, PNG, or WEBP.`);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (contentHashes.has(hash)) errors.push(`${prefix} duplicates image content already used by record ${contentHashes.get(hash)}.`);
      else contentHashes.set(hash, index);
    } catch {
      errors.push(`${prefix}.imagePath is missing or unreadable.`);
    }
  }
  if (errors.length) {
    console.error(`Dataset validation failed (${errors.length} issue(s)).`);
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
  } else {
    console.log(`Dataset valid: ${dataset.images.length} record(s); ${dataset.images.filter((record) => record.labelStatus === "verified").length} marked labels; ${dataset.images.filter((record) => record.labelStatus === "unverified").length} unverified.`);
    console.log("No image paths, bytes, or private metadata were printed.");
  }
} catch (error) {
  console.error("Could not read evaluation dataset. Copy the example template into the local ignored dataset directory first.");
  process.exitCode = 1;
}
