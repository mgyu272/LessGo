// Deterministic comparison against existing Less GO story text. This module does not
// use the 4-A photo manifest as evidence and never asks Gemini to create historical facts.
import { readData } from "./gemini.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Static module-relative reference helps Vercel trace and package this server-only JSON.
// process.cwd() may differ between local dev and deployed serverless functions.
const OFFICIAL_EVIDENCE_URL = new URL("../../server-data/heritage_evidence_4d.json", import.meta.url);
let officialEvidencePromise;
async function readOfficialEvidence() {
  if (!officialEvidencePromise) {
    officialEvidencePromise = (async () => {
      let lastError;
      for (const location of [OFFICIAL_EVIDENCE_URL, path.join(process.cwd(), "server-data", "heritage_evidence_4d.json")]) {
        try {
          const data = JSON.parse(await readFile(location, "utf8"));
          if (!Array.isArray(data?.objects) || !data.objects.length) throw new Error("Invalid official heritage evidence format");
          return data;
        } catch (error) {
          lastError = error;
        }
      }
      // Do not silently turn missing server assets into "no official facts".
      console.error("[history-evidence] official heritage data unavailable; verify function file tracing", lastError?.code || "invalid_data");
      return { objects: [], unavailable: true };
    })();
  }
  return officialEvidencePromise;
}

// Return a small, place-scoped vocabulary for visual recognition. These labels
// are suggestions only; they are never used as evidence that a photo depicts an object.
const CANDIDATE_FILES = {simujang: "heritage_candidates_simujang.json", jeongneung: "heritage_candidates_jeongneung.json", uiryeong: "heritage_candidates_uiryeong.json"};
export async function getPlaceVisualCandidates(spotId) {
  const file = CANDIDATE_FILES[spotId];
  if (!file) return [];
  try {
    const url = new URL(`../../server-data/${file}`, import.meta.url);
    const data = JSON.parse(await readFile(url, "utf8"));
    return Array.isArray(data.objects) ? data.objects.map(({id,name,aliases,visualKeywords}) => ({id,name,aliases,visualKeywords})) : [];
  } catch (error) {
    console.warn("[history-evidence] visual candidates unavailable", spotId, error?.code || "invalid_data");
    return [];
  }
}

export async function getOfficialVisualCandidates(spotId, limit = 12) {
  if (typeof spotId !== "string" || !spotId || !Number.isInteger(limit) || limit < 1) return [];
  const officialData = await readOfficialEvidence();
  return (officialData.objects || [])
    .filter((entry) => entry.spotId === spotId && entry.verificationStatus === "official_verified")
    .slice(0, Math.min(limit, 12))
    .map((entry) => ({
      name: entry.objectName,
      aliases: Array.isArray(entry.aliases) ? entry.aliases.slice(0, 8) : [],
      types: Array.isArray(entry.objectType) ? entry.objectType.slice(0, 4) : [],
    }))
    .filter((entry) => typeof entry.name === "string" && entry.name.trim());
}

const PLACE_ENTITIES = {
  simujang: [
    {
      canonical: "심우장",
      aliases: ["심우장", "Simujang", "Simujang House", "심우장 한옥"],
      cards: [0, 1, 2], terms: ["심우장", "Simujang"],
      objectTypes: ["house", "hanok", "building", "residence", "집", "한옥", "건물", "유적", "문화유산", "heritage site", "cultural heritage", "place"],
    },
    {
      canonical: "한옥",
      aliases: ["한옥", "Hanok", "traditional Korean house", "traditional hanok"],
      cards: [0, 1, 2], terms: ["한옥", "hanok", "집", "house"],
      objectTypes: ["house", "hanok", "building", "residence", "집", "한옥", "건물"],
    },
    {
      canonical: "한용운",
      aliases: ["한용운", "만해 한용운", "Han Yongun", "Han Yong-un", "Manhae"],
      cards: [0, 2], terms: ["한용운", "Han Yongun", "Han Yong-un", "Manhae"],
      objectTypes: ["person", "인물", "사람", "승려", "시인", "독립운동가"],
    },
  ],
  jeongneung: [
    {
      canonical: "정릉",
      aliases: ["정릉", "Jeongneung", "Jeongneung Royal Tomb", "Tomb of Queen Sindeok"],
      cards: [0, 1, 2], terms: ["정릉", "Jeongneung", "Queen Sindeok"],
      objectTypes: ["tomb", "royal tomb", "mausoleum", "왕릉", "무덤", "묘", "유적", "문화유산", "heritage site", "cultural heritage", "place"],
    },
    {
      canonical: "신덕왕후",
      aliases: ["신덕왕후", "신덕왕후 강씨", "Queen Sindeok", "Queen Sindok", "Sindeok Wanghu"],
      cards: [0, 1, 2], terms: ["신덕왕후", "Queen Sindeok", "Sindeok"],
      objectTypes: ["person", "queen", "royal consort", "왕비", "인물"],
    },
    {
      canonical: "석물",
      aliases: ["석물", "stonework", "stone figure", "stone figures", "stone sculpture"],
      cards: [1], terms: ["석물", "stone figures", "stonework"],
      objectTypes: ["석물", "석상", "stone figure", "stonework", "stone sculpture", "stone statue"],
    },
  ],
  uiryeong: [
    {
      canonical: "의릉",
      aliases: ["의릉", "Uireung", "Uiryeung", "Uireung Royal Tomb"],
      cards: [0, 1, 2], terms: ["의릉", "Uireung", "Uiryeung"],
      objectTypes: ["tomb", "royal tomb", "mausoleum", "왕릉", "무덤", "묘", "유적", "문화유산", "heritage site", "cultural heritage", "place"],
    },
    {
      canonical: "상하이봉릉",
      aliases: ["상하이봉릉", "front-to-back tombs", "front and back tomb arrangement", "vertically arranged double tomb"],
      cards: [1], terms: ["상하이봉릉", "앞뒤로 놓여", "front and back", "front-to-back"],
      objectTypes: ["tomb arrangement", "burial arrangement", "왕릉 배치", "릉 배치", "layout"],
    },
    {
      canonical: "문인석",
      aliases: ["문인석", "civil official stone statue", "stone civil official"],
      cards: [1], terms: ["문인석", "civil official stone statue", "civil officials", "officials"],
      objectTypes: ["stone figure", "stone statue", "석물", "석상", "문인석"],
    },
    {
      canonical: "석호",
      aliases: ["석호", "stone tiger", "stone tiger statue"],
      cards: [1], terms: ["석호", "stone tiger", "tigers"],
      objectTypes: ["stone figure", "stone statue", "석물", "석상", "석호"],
    },
    {
      canonical: "석양",
      aliases: ["석양", "stone sheep", "stone sheep statue"],
      cards: [1], terms: ["석양", "stone sheep", "sheep"],
      objectTypes: ["stone figure", "stone statue", "석물", "석상", "석양"],
    },
    {
      canonical: "석물",
      aliases: ["석물", "stonework", "stone figures", "stone sculptures"],
      cards: [1], terms: ["석물", "stone figures", "stonework"],
      objectTypes: ["석물", "석상", "stone figure", "stonework", "stone sculpture", "stone statue"],
    },
  ],
};

// Vocabulary normalization only; entries here do not count as historical evidence.
const UNSOURCED_OBJECT_ALIASES = [
  { canonical: "정자각", aliases: ["정자각", "Jeongjagak", "royal ritual hall", "T-shaped shrine hall"] },
  { canonical: "홍살문", aliases: ["홍살문", "Hongsalmun", "red spiked gate", "red arrow gate"] },
  { canonical: "비각", aliases: ["비각", "Bigak", "stele pavilion", "memorial stele pavilion"] },
  { canonical: "수라간", aliases: ["수라간", "Suragan", "royal kitchen"] },
  { canonical: "재실", aliases: ["재실", "Jaesil", "ritual preparation building"] },
  { canonical: "제기고", aliases: ["제기고", "Jegigo", "ritual vessel storehouse"] },
  { canonical: "능침", aliases: ["능침", "Neungchim", "tomb sanctuary"] },
  { canonical: "봉분", aliases: ["봉분", "bongbun", "burial mound"] },
];

const BASIC_LIMITATIONS = {
  ko: ["역사 자료에서 명칭이나 사실을 확인해도 사진 속 대상의 정체가 증명되는 것은 아닙니다.", "시각 특징은 대상 명칭이나 역사적 사실의 근거로 사용하지 않았습니다."],
  en: ["Finding a name or fact in historical records does not prove the identity of the object in the photo.", "Visual features were not used as evidence for an object's name or historical facts."],
};

const ENGLISH_OBJECT_NAMES = {
  심우장: "Simujang",
  정자각: "Jeongjagak",
  홍살문: "Hongsalmun",
  비각: "Stele Pavilion",
  정릉: "Jeongneung Royal Tomb",
  의릉: "Uireung Royal Tomb",
  "정릉 석물": "Jeongneung tomb sculptures",
  "의릉 석물": "Uireung tomb sculptures",
  "의릉 재실 터 (논문 기록상 멸실)": "Uireung Jaesil",
  석물: "Stone sculptures",
  한옥: "Hanok",
  한용운: "Han Yong-un",
  신덕왕후: "Queen Sindeok",
};

const phrase = (lang, ko, en) => lang === "en" ? en : ko;
const localizedObjectName = (name, lang) => lang === "en" ? (ENGLISH_OBJECT_NAMES[name] || name) : name;

function norm(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function exactAlias(candidate, aliases) {
  const value = norm(candidate);
  if (!value) return false;
  return aliases.some((alias) => norm(alias) === value);
}

// Curated type families bridge Vision's visual labels to the official registry's
// administrative/heritage vocabulary. This is a controlled lexicon, not model-generated synonym expansion.
const OBJECT_TYPE_FAMILIES = [
  { id: "residential_building", labels: [
    "house", "traditional house", "traditional korean house", "traditional hanok", "hanok", "building", "traditional building", "structure", "architecture", "residence",
    "집", "가옥", "전통 가옥", "전통가옥", "전통 건축물", "전통건축물", "한옥", "건물", "건축물",
  ] },
  { id: "royal_tomb", labels: ["tomb", "royal tomb", "mausoleum", "왕릉", "무덤", "묘"] },
  { id: "gate", labels: ["gate", "entrance gate", "archway", "문", "문루", "홍살문", "출입문", "대문"] },
  { id: "stone_artifact", labels: [
    "stone figure", "stonework", "stone sculpture", "stone statue", "stone sculptures", "stone figures",
    "석물", "석상", "문인석", "석호", "석양",
  ] },
  { id: "person", labels: ["person", "human", "man", "woman", "people", "사람", "인물", "남성", "여성"] },
  { id: "food", labels: ["food", "dish", "meal", "음식", "요리", "식사"] },
  { id: "vegetation", labels: ["tree", "plant", "flower", "vegetation", "나무", "식물", "꽃", "수목"] },
  { id: "animal", labels: ["animal", "bird", "dog", "cat", "insect", "동물", "새", "개", "고양이", "곤충"] },
  { id: "vehicle", labels: ["vehicle", "car", "bus", "bicycle", "자동차", "차량", "버스", "자전거"] },
  { id: "document", labels: ["document", "book", "paper", "문서", "책", "종이", "기록물"] },
];

function objectTypeFamily(value) {
  const normalized = norm(value);
  return OBJECT_TYPE_FAMILIES.find((family) => family.labels.some((label) => norm(label) === normalized))?.id || null;
}

function compareObjectType(objectType, recordedTypes = []) {
  if (!String(objectType || "").trim()) return "undetermined";
  if (recordedTypes.some((allowed) => norm(allowed) === norm(objectType))) return "compatible";
  const observedFamily = objectTypeFamily(objectType);
  if (!observedFamily) return "undetermined";
  const recordedFamilies = recordedTypes.map(objectTypeFamily).filter(Boolean);
  if (!recordedFamilies.length) return "undetermined";
  return recordedFamilies.includes(observedFamily) ? "compatible" : "incompatible";
}

function findCrossPlace(candidate, currentSpot, allSpots) {
  return allSpots.find((spot) => spot.id !== currentSpot.id && exactAlias(candidate, [spot.name.ko, spot.name.en]));
}

function typeIsCompatible(objectType, entity) {
  return compareObjectType(objectType, entity.objectTypes);
}

function splitSentences(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split(/(?<=[.!?。])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function getEvidenceCards(spot, entity, lang) {
  const facts = [];
  const cards = new Set();
  for (const index of entity.cards) {
    const card = spot.cards?.[index];
    if (!card) continue;
    const body = card.body?.[lang] || card.body?.ko || card.body?.en || "";
    const terms = entity.terms.map(norm).filter(Boolean);
    const sentences = splitSentences(body).filter((sentence) => terms.some((term) => norm(sentence).includes(term)));
    if (!sentences.length) continue;
    cards.add(index);
    for (const sentence of sentences) {
      if (!facts.some((fact) => norm(fact) === norm(sentence))) facts.push(sentence);
    }
  }
  return { facts: facts.slice(0, 8), cardIndexes: [...cards] };
}

function getSourceRecords(spot, cardIndexes, lang) {
  const records = [];
  const seen = new Set();
  for (const index of cardIndexes) {
    const card = spot.cards?.[index];
    if (!card) continue;
    const linked = Array.isArray(card.sources)
      ? card.sources.map((sourceIndex) => spot.sources?.[sourceIndex]).filter(Boolean)
      : [];
    for (const source of linked) {
      const key = `${source.title}|${source.url || ""}`;
      if (!seen.has(key)) { seen.add(key); records.push({ title: source.title, url: source.url || null }); }
    }
    // Preserve traceability to the actual authored material without pretending it is an official citation.
    if (!linked.length) {
      const title = card.title?.[lang] || card.title?.ko || card.title?.en || `Story ${index + 1}`;
      const key = `internal|${title}`;
      if (!seen.has(key)) { seen.add(key); records.push({ title, url: null, sourceType: "internal_story_text" }); }
    }
  }
  return records;
}

function result(status, matchedObjectName = null, supportedFacts = [], sources = [], limitations = [], sourceLevel = "none", factSources = [], lang = "ko") {
  return {
    evidenceStatus: status,
    sourceLevel,
    matchedObjectName,
    supportedFacts,
    factSources,
    sources,
    limitations: [...BASIC_LIMITATIONS[lang], ...limitations],
  };
}

export async function verifyImageEvidence({ spotId, candidateName, objectType, visualFeatures = [], identificationStatus, lang = "ko" }) {
  if (typeof spotId !== "string" || !spotId || typeof candidateName !== "string" || candidateName.length > 200 ||
      typeof objectType !== "string" || objectType.length > 120 || !Array.isArray(visualFeatures) || visualFeatures.length > 12 ||
      !visualFeatures.every((feature) => typeof feature === "string" && feature.length <= 240) ||
      !["identified", "uncertain", "unknown"].includes(identificationStatus) || !["ko", "en"].includes(lang)) {
    throw Object.assign(new Error("invalid evidence verification input"), { status: 400 });
  }

  let spotData;
  try {
    spotData = await readData("spots.json");
  } catch {
    return result("insufficient", null, [], [], [phrase(lang, "기존 장소 자료를 읽지 못해 근거 대조를 수행하지 못했습니다.", "The saved place materials could not be read, so the evidence check could not be completed.")], "none", [], lang);
  }
  const spots = spotData.spots || [];
  const spot = spots.find((item) => item.id === spotId);
  if (!spot) return result("insufficient", null, [], [], [phrase(lang, "현재 장소 ID와 일치하는 Less GO 역사 자료가 없습니다.", "No Less GO history material matches this place ID.")], "none", [], lang);
  if (identificationStatus === "unknown" || !candidateName.trim()) {
    return result("insufficient", null, [], [], [phrase(lang, "Vision 결과에 대조할 명칭 후보가 없습니다.", "The Vision result has no name candidate to compare.")], "none", [], lang);
  }

  const otherSpot = findCrossPlace(candidateName, spot, spots);
  if (otherSpot) {
    return result("conflicting", null, [], [], [phrase(lang, `명칭 후보가 현재 장소가 아닌 '${otherSpot.name[lang] || otherSpot.name.ko}'와 일치합니다.`, `The name candidate matches '${otherSpot.name.en || otherSpot.name.ko}', which is a different place.`)], "none", [], lang);
  }

  // Official facts are searched first and are scoped to this exact spotId. The
  // presence of a facility in a record is not treated as proof that it appears
  // in the submitted photograph.
  const officialData = await readOfficialEvidence();
  if (officialData.unavailable) {
    return result("insufficient", null, [], [], [phrase(lang,
      "서버에서 공식 역사 자료를 불러오지 못해 역사 사실을 검증할 수 없습니다.",
      "The server could not load the official heritage records; historical claims cannot currently be verified.")], "none", [], lang);
  }
  const officialObject = (officialData.objects || []).find((entry) =>
    entry.spotId === spotId && exactAlias(candidateName, entry.aliases || [])
  );
  if (officialObject) {
    if (officialObject.verificationStatus !== "official_verified" || !Array.isArray(officialObject.facts) || !officialObject.facts.length) {
      return result("insufficient", localizedObjectName(officialObject.objectName || null, lang), [], [], [phrase(lang, "해당 대상의 공식 자료가 아직 직접 검증되지 않았습니다.", "Official records for this object have not yet been directly verified.")], "none", [], lang);
    }
    const allowedTypes = officialObject.objectType || [];
    const typeComparison = compareObjectType(objectType, allowedTypes);
    if (typeComparison === "incompatible") {
      return result("conflicting", localizedObjectName(officialObject.objectName, lang), [], [], [phrase(lang, `명칭 후보는 '${officialObject.objectName}'로 대조되지만 대상 종류 '${objectType}'가 공식 자료의 분류와 맞지 않습니다.`, `The name matches '${localizedObjectName(officialObject.objectName, "en")}', but the object type '${objectType}' conflicts with the official classification.`)], "none", [], lang);
    }
    const sourceById = new Map((officialObject.sources || []).map((source) => [source.sourceId, ({
      sourceId: source.sourceId,
      agency: source.agency,
      title: lang === "en" ? (source.titleEn || source.title) : source.title,
      titleEn: source.titleEn || null,
      url: source.url,
      supports: source.supports,
      sourceLevel: "official",
    })]));
    const factSources = officialObject.facts.map((fact) => ({
      factId: fact.factId,
      fact: fact[lang] || fact.ko || fact.en,
      verificationStatus: "verified",
      sources: (fact.sourceIds || []).map((sourceId) => sourceById.get(sourceId))
        .filter((source) => source?.sourceLevel === "official" && source.url?.startsWith("https://") && source.supports?.trim()),
    })).filter((entry) => entry.fact && entry.factId && entry.sources.length);
    if (!factSources.length) {
      return result("insufficient", localizedObjectName(officialObject.objectName, lang), [], [], [phrase(lang, "공식 자료와 개별 사실의 출처 연결을 확인하지 못했습니다.", "The links between the official records and the individual facts could not be confirmed.")], "none", [], lang);
    }
    const officialFacts = factSources.map((entry) => entry.fact);
    const sources = [...new Map(factSources.flatMap((entry) => entry.sources).map((source) => [`${source.title}|${source.url}`, source])).values()];
    const limitations = [
      phrase(lang, "공식 자료는 이 장소의 시설 또는 기록 사실을 뒷받침하지만, 사진 속 대상이 그 시설이라고 확정하지는 않습니다.", "Official sources support facts about a facility or record at this place, but do not confirm that the photo shows that facility."),
      ...((lang === "en" ? officialObject.notesEn : officialObject.notes) || []),
    ];
    if (identificationStatus === "uncertain") limitations.push(phrase(lang, "Vision의 식별 상태가 uncertain이므로 사진과 후보 대상의 일치 여부는 미확정입니다.", "Vision marked the identification as uncertain, so the photo-to-candidate match remains unresolved."));
    if (identificationStatus === "identified") limitations.push(phrase(lang, "Vision의 identified 표시는 모델의 시각 추정이며 현장 확인이나 공식 사진 대조로 검증된 신원은 아닙니다.", "Vision's 'identified' label is a model estimate, not an identity verified on site or against official photographs."));
    if (visualFeatures.length) limitations.push(phrase(lang, "visualFeatures는 관찰 결과로만 전달받았으며 공식 역사 사실의 근거로 사용하지 않았습니다.", "Visual features were treated as observations only, not as evidence for historical facts."));
    if (typeComparison === "undetermined" && objectType) limitations.push(phrase(lang, `대상 종류 '${objectType}'는 공식 분류와 의미상 직접 비교할 수 없어 종류만으로 충돌을 판정하지 않았습니다.`, `The visual label '${objectType}' could not be mapped to the official classification, so the type label alone was not treated as a conflict.`));
    return result("supported", localizedObjectName(officialObject.objectName, lang), officialFacts, sources, limitations, "official", factSources, lang);
  }

  const entity = (PLACE_ENTITIES[spotId] || []).find((entry) => exactAlias(candidateName, entry.aliases));
  if (!entity) {
    const unsourcedName = UNSOURCED_OBJECT_ALIASES.find((entry) => exactAlias(candidateName, entry.aliases));
    return result("insufficient", localizedObjectName(unsourcedName?.canonical || null, lang), [], [], [
      unsourcedName
        ? phrase(lang, `명칭 후보 '${unsourcedName.canonical}'는 어휘상 정규화했지만 현재 장소의 기존 역사 자료에서 개별 대상 설명을 찾지 못했습니다.`, `The name '${localizedObjectName(unsourcedName.canonical, "en")}' was normalized, but no description of that individual object was found in the saved materials for this place.`)
      : phrase(lang, "명칭 후보가 현재 장소의 공식 자료 또는 기존 역사 자료에서 확인되지 않았습니다.", "The name candidate was not found in official or saved history materials for this place."),
      phrase(lang, "4-A 참고 사진 manifest의 파일명은 역사 근거로 검색하거나 인용하지 않았습니다.", "Filenames in the 4-A reference-photo manifest were not searched or cited as historical evidence."),
    ], "none", [], lang);
  }

  const typeComparison = typeIsCompatible(objectType, entity);
  if (typeComparison === "incompatible") {
    return result("conflicting", localizedObjectName(entity.canonical, lang), [], [], [phrase(lang, `명칭 후보는 '${entity.canonical}'로 대조되지만 대상 종류 '${objectType}'가 자료에서 확인되는 종류와 맞지 않습니다.`, `The name matches '${localizedObjectName(entity.canonical, "en")}', but the object type '${objectType}' conflicts with the saved record.`)], "none", [], lang);
  }

  const { facts, cardIndexes } = getEvidenceCards(spot, entity, lang);
  if (!facts.length) {
    return result("insufficient", localizedObjectName(entity.canonical, lang), [], [], [phrase(lang, "명칭 후보는 어휘상 일치하지만 관련 역사 문장이나 개별 대상 근거가 기존 자료에 없습니다.", "The name matches a known term, but the saved materials contain no related historical passage or evidence about this individual object.")], "none", [], lang);
  }
  const sources = getSourceRecords(spot, cardIndexes, lang);
  const limitations = [];
  if (identificationStatus === "uncertain") limitations.push(phrase(lang, "Vision의 식별 상태가 uncertain이므로 사진과 후보 대상의 일치 여부는 미확정입니다.", "Vision marked the identification as uncertain, so the photo-to-candidate match remains unresolved."));
  if (identificationStatus === "identified") limitations.push(phrase(lang, "Vision의 identified 표시는 모델의 시각 추정이며 현장 또는 공식 기록으로 확인된 신원은 아닙니다.", "Vision's 'identified' label is a model estimate, not an identity confirmed on site or in official records."));
  if (typeComparison === "undetermined" && objectType) limitations.push(phrase(lang, `대상 종류 '${objectType}'는 기존 자료 분류와 의미상 비교할 수 없어 종류만으로 충돌을 판정하지 않았습니다.`, `The visual label '${objectType}' could not be mapped to the saved classification, so the type label alone was not treated as a conflict.`));
  if (!(spot.sources || []).length) limitations.push(phrase(lang, "이 장소에는 연결된 공식 출처 URL이나 출처 ID가 없습니다. 아래 제목은 근거 문장이 포함된 Less GO 내부 이야기 카드입니다.", "This place has no linked official source URL or ID. The titles below refer to Less GO story cards containing the matched text."));
  limitations.push(phrase(lang, "sourceLevel이 internal인 결과는 Less GO 내부 자료의 뒷받침만 뜻하며, 공식 검증 완료를 뜻하지 않습니다.", "An 'internal' source level means the result is supported only by Less GO materials; it is not officially verified."));
  if (visualFeatures.length) limitations.push(phrase(lang, "visualFeatures는 관찰 결과로만 전달받았으며 역사적 사실을 추가로 뒷받침하는 출처로 취급하지 않았습니다.", "Visual features were treated as observations, not as additional sources for historical facts."));
  return result("supported", localizedObjectName(entity.canonical, lang), facts, sources, limitations, "internal", [], lang);
}

export const evidenceVocabulary = UNSOURCED_OBJECT_ALIASES;

// This summary keeps photo identity, reference-image comparison, and historical
// claim support independent. Only curated facts linked to a supporting official
// source are marked verified; internal story text and Gemini context remain unverified.
export function buildHistoryVerification({ evidence, identificationStatus, explanation, referenceComparison } = {}) {
  const verifiedClaims = (evidence?.factSources || [])
    .filter((entry) => entry.verificationStatus === "verified" && typeof entry.fact === "string" && Array.isArray(entry.sources) &&
      entry.sources.some((source) => source?.sourceLevel === "official" && source.url?.startsWith("https://") && typeof source.supports === "string" && source.supports.trim()))
    .map((entry) => ({
      factId: entry.factId,
      claim: entry.fact,
      verificationStatus: "verified",
      sourceIds: entry.sources.filter((source) => source?.sourceLevel === "official" && source.url?.startsWith("https://") && source.supports?.trim()).map((source) => source.sourceId).filter(Boolean),
    }));
  const internalClaims = evidence?.sourceLevel === "internal"
    ? (evidence.supportedFacts || []).map((claim) => ({ claim, verificationStatus: "unverified", sourceLevel: "internal", sourceIds: [] }))
    : [];
  const aiClaims = (explanation?.aiContext || []).filter((claim) => typeof claim === "string" && claim.trim())
    .map((claim) => ({ claim, verificationStatus: "unverified", sourceLevel: "ai_generated", sourceIds: [] }));
  // This corpus does not yet contain a claim-by-claim contradiction registry.
  // Therefore candidate mismatches are kept on candidateEvidenceStatus and are
  // never mislabeled as contradictions between historical claims.
  return {
    status: verifiedClaims.length ? "verified" : "insufficient_evidence",
    sourceLevel: verifiedClaims.length ? "official" : evidence?.sourceLevel === "internal" ? "internal" : "none",
    photoIdentityStatus: ["identified", "uncertain", "unknown"].includes(identificationStatus) ? identificationStatus : "unknown",
    candidateEvidenceStatus: ["supported", "insufficient", "conflicting"].includes(evidence?.evidenceStatus) ? evidence.evidenceStatus : "insufficient",
    referenceComparisonStatus: ["matched", "mismatched", "inconclusive", "not_compared"].includes(referenceComparison?.status) ? referenceComparison.status : "not_compared",
    claims: [...verifiedClaims, ...internalClaims, ...aiClaims],
  };
}
