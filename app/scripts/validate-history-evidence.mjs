import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const evidence = JSON.parse(await readFile(new URL("../server-data/heritage_evidence_4d.json", import.meta.url), "utf8"));
const spots = JSON.parse(await readFile(new URL("../public/data/spots.json", import.meta.url), "utf8")).spots;
const knownSpotIds = new Set(spots.map((spot) => spot.id));
const ids = new Set();
const counters = { total: evidence.objects.length, officialObjects: 0, officialFacts: 0, unverifiedObjects: 0 };

assert.equal(typeof evidence.version, "string");
assert.ok(Array.isArray(evidence.objects));
for (const object of evidence.objects) {
  for (const field of ["spotId", "objectId", "objectName", "aliases", "objectType", "facts", "sources", "verificationStatus"]) {
    assert.ok(Object.hasOwn(object, field), `${object.objectId || "object"} is missing ${field}`);
  }
  assert.ok(knownSpotIds.has(object.spotId), `Unknown spotId: ${object.spotId}`);
  assert.ok(object.objectId && !ids.has(object.objectId), `Missing or duplicate objectId: ${object.objectId}`);
  ids.add(object.objectId);
  assert.ok(object.aliases.length > 0 && object.aliases.every((value) => typeof value === "string" && value.trim()));
  assert.ok(Array.isArray(object.objectType) && object.objectType.length > 0);
  assert.ok(Array.isArray(object.facts) && object.facts.every((fact) => fact.ko && fact.en && fact.factId && Array.isArray(fact.sourceIds) && fact.sourceIds.length > 0));
  assert.ok(["official_verified", "unverified"].includes(object.verificationStatus));
  if (object.verificationStatus === "official_verified") {
    assert.ok(object.sources.length > 0, `Verified object has no sources: ${object.objectId}`);
    counters.officialObjects++;
    counters.officialFacts += object.facts.length;
  } else counters.unverifiedObjects++;
  for (const source of object.sources) {
    assert.ok(source.sourceId && source.agency && source.title && source.titleEn && source.supports, `Incomplete source for ${object.objectId}`);
    assert.ok(/^https:\/\//u.test(source.url), `Invalid source URL for ${object.objectId}: ${source.url}`);
  }
  const sourceIds = new Set(object.sources.map((source) => source.sourceId));
  for (const fact of object.facts) assert.ok(fact.sourceIds.every((sourceId) => sourceIds.has(sourceId)), `Unknown fact source for ${fact.factId}`);
}

for (const spotId of ["simujang", "jeongneung", "uiryeong"]) {
  assert.ok(evidence.objects.some((object) => object.spotId === spotId), `No entries for ${spotId}`);
}
console.log(`Heritage evidence valid: ${JSON.stringify(counters)}`);
