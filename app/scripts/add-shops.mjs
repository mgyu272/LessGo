// 상권 조사 가게를 카카오 장소 검색으로 찾아서 public/data/shops.json에 넣어요 (주변 가게, 쿠폰 없음)
// 사용법 (app 폴더에서):  npm run shops:add            ← 미리보기만 (파일 안 바꿈)
//                         npm run shops:add -- --write ← shops.json에 저장
// .env.local 의 KAKAO_REST_KEY 를 써요. 키는 브라우저 코드로 나가지 않아요.

import { readFile, writeFile } from "node:fs/promises";

// 11/2 2차 자료조사 (조가은 · 박소영). near = 가까운 목적지
const SURVEY = [
  ["simujang", "성북동 누룽지백숙", "서울 성북구 성북동 281-1"],
  ["simujang", "선동 보리밥", "서울 성북구 성북동 88"],
  ["simujang", "금왕돈까스", "서울 성북구 성북동 256-2"],
  ["simujang", "쌍다리돼지불백", "서울 성북구 성북동 109-2"],
  ["simujang", "수연산방", "서울 성북구 성북동 248"],
  ["simujang", "조셉의 커피나무", "서울 성북구 성북동 350-3"],
  ["simujang", "성북로", "서울 성북구 성북동 254-8"],
  ["jeongneung", "봉화묵집", "서울 성북구 아리랑로19길 46-2"],
  ["jeongneung", "할머니만두국", "서울 성북구 아리랑로19길 9-8"],
  ["jeongneung", "후후세이지", "서울 성북구 정릉로26길 32"],
  ["jeongneung", "덤브다이버", "서울 성북구 아리랑로19길 30"],
  ["jeongneung", "더로스팅", "서울 성북구 정릉로36길 88"],
  ["uiryeong", "능이마을 본점", "서울 성북구 돌곶이로 21"],
  ["uiryeong", "이문동그집 본점", "서울 동대문구 이문로 195"],
  ["uiryeong", "타입커피", "서울 성북구 화랑로32길 38"],
  ["uiryeong", "카페나누기", "서울 성북구 돌곶이로22길 14"],
  ["uiryeong", "하이드어웨이", "서울 성북구 화랑로32길 21"],
];

const key = process.env.KAKAO_REST_KEY?.trim();
if (!key) { console.error("❌ .env.local 에 KAKAO_REST_KEY 가 없어요."); process.exit(1); }
const write = process.argv.includes("--write");
const FILE = "public/data/shops.json";

async function kakao(path, params) {
  const url = `https://dapi.kakao.com${path}?${new URLSearchParams(params)}`;
  const r = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

const found = [], problems = [];

for (const [near, name, addr] of SURVEY) {
  try {
    // 1) 주소 → 좌표
    const a = (await kakao("/v2/local/search/address.json", { query: addr })).documents[0];
    // 2) 그 주소 근처(300m)에서 가게 이름으로 검색
    const params = { query: name, size: 5, sort: "distance" };
    if (a) Object.assign(params, { x: a.x, y: a.y, radius: 300 });
    const places = (await kakao("/v2/local/search/keyword.json", params)).documents;
    const p = places[0];
    if (!p) { problems.push(`❓ ${name} (${addr}) — 카카오에서 가게를 못 찾았어요${a ? " (주소는 찾음)" : ""}`); continue; }
    const shop = {
      id: `kakao-${p.id}`,
      name: { ko: p.place_name, en: p.place_name },
      lat: Number(p.y), lng: Number(p.x),
      partner: false, visit_coupon: false, buy_stars: 0, coupon: null,
      category: p.category_name, address: p.road_address_name || p.address_name,
      kakao_url: p.place_url, near, source: "2026-11-02 상권 2차 자료조사",
    };
    found.push(shop);
    const note = p.place_name.replace(/\s/g, "") !== name.replace(/\s/g, "") ? `  ← 조사 이름 "${name}"과 달라요, 확인 필요` : "";
    console.log(`✅ ${p.place_name} · ${p.category_name.split(" > ").pop()} · ${shop.address}${note}`);
  } catch (e) {
    problems.push(`⚠️  ${name} — ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 150));
}

problems.forEach((m) => console.log(m));
console.log(`\n찾은 가게 ${found.length} / ${SURVEY.length}`);

if (!write) { console.log("미리보기예요. 저장하려면:  npm run shops:add -- --write"); process.exit(0); }
const data = JSON.parse(await readFile(FILE, "utf8"));
const kept = data.shops.filter((s) => !s.id.startsWith("kakao-")); // 예시 가게는 그대로, 예전에 넣은 카카오 가게는 새로 덮어써요
data.shops = [...kept, ...found];
await writeFile(FILE, JSON.stringify(data, null, 1) + "\n", "utf8");
console.log(`💾 ${FILE} 저장 (가게 ${data.shops.length}곳)`);
