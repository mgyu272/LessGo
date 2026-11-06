// 둘러볼 곳(public/data/explore.json)의 1차 자료조사 주변 상권(survey_shops)을 카카오 장소 검색으로 찾아서
// public/data/shops.json에 주변 가게(쿠폰 없음)로 넣어요.
// 사용법 (app 폴더에서):  npm run shops:explore            ← 미리보기만 (파일 안 바꿈)
//                         npm run shops:explore -- --write ← shops.json에 저장
// .env.local 의 KAKAO_REST_KEY 를 써요. 같은 가게가 여러 장소 근처면 한 번만 넣고 near_places에 장소를 모두 적어요.

import { readFile, writeFile } from "node:fs/promises";

const key = process.env.KAKAO_REST_KEY?.trim();
if (!key) { console.error("❌ .env.local 에 KAKAO_REST_KEY 가 없어요."); process.exit(1); }
const write = process.argv.includes("--write");
const SHOPS = "public/data/shops.json";
const RADIUS_M = 800; // 장소에서 이 거리 안에서만 찾아요

const kakao = async (params) => {
  const r = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?${new URLSearchParams(params)}`, { headers: { Authorization: `KakaoAK ${key}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return (await r.json()).documents;
};

const { places } = JSON.parse(await readFile("public/data/explore.json", "utf8"));
const found = new Map(), problems = [];
for (const p of places) {
  if (!p.survey_shops?.length) continue;
  if (p.lat == null) { problems.push(`⚠️  ${p.name.ko}: 좌표가 없어서 근처 검색을 못 했어요 (${p.survey_shops.join(", ")})`); continue; }
  for (const name of p.survey_shops) {
    try {
      const doc = (await kakao({ query: name, x: p.lng, y: p.lat, radius: RADIUS_M, sort: "distance", size: 5 }))[0];
      if (!doc) { problems.push(`❓ ${name} (${p.name.ko} 근처 ${RADIUS_M}m) — 카카오에서 못 찾았어요`); continue; }
      const id = `kakao-${doc.id}`;
      if (found.has(id)) { found.get(id).near_places.push(p.id); continue; }
      const cat = doc.category_name || "";
      found.set(id, {
        id, name: { ko: doc.place_name, en: doc.place_name }, lat: Number(doc.y), lng: Number(doc.x),
        partner: false, visit_coupon: false, buy_stars: 0, coupon: null,
        category: cat, address: doc.road_address_name || doc.address_name, kakao_url: doc.place_url,
        near: p.spot_id || null, near_places: [p.id], source: "2026-10-18 1차 자료조사(주변 상권)",
      });
      const note = doc.place_name.replace(/\s/g, "") !== name.replace(/\s/g, "") ? `  ← 조사 이름 "${name}"과 달라요, 확인 필요` : "";
      const kind = !cat.startsWith("음식점") && !cat.includes("카페") ? "  ← 음식점·카페가 아니에요(시장 등)" : "";
      console.log(`✅ ${doc.place_name} · ${cat.split(" > ").pop()} · ${p.name.ko} 근처 ${doc.distance}m${note}${kind}`);
    } catch (e) { problems.push(`⚠️  ${name} — ${e.message}`); }
    await new Promise((r) => setTimeout(r, 150));
  }
}
problems.forEach((m) => console.log(m));
console.log(`\n찾은 가게 ${found.size}곳`);
if (!write) { console.log("미리보기예요. 저장하려면:  npm run shops:explore -- --write"); process.exit(0); }

const data = JSON.parse(await readFile(SHOPS, "utf8"));
const byId = new Map(data.shops.map((s) => [s.id, s]));
let added = 0, merged = 0;
for (const s of found.values()) {
  const old = byId.get(s.id);
  if (old) { old.near_places = [...new Set([...(old.near_places || []), ...s.near_places])]; merged++; } // 이미 있는 가게(2차 조사)는 장소만 더해요
  else { data.shops.push(s); added++; }
}
await writeFile(SHOPS, JSON.stringify(data, null, 1) + "\n", "utf8");
console.log(`💾 ${SHOPS} 저장 · 새 가게 ${added}곳 · 기존 가게에 장소 연결 ${merged}곳 (전체 ${data.shops.length}곳)`);
