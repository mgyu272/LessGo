// 장소 대표 사진: 한국어 위키백과 문서의 대표 이미지(위키미디어 공용, 자유 이용 사진)를 불러와요.
// - 데이터에 photo: { url, credit, link }가 있으면 그걸 먼저 써요 (국가유산청·구청 공식 사진을 넣고 싶을 때)
// - 문서 이름이 장소 이름과 다르면 WIKI_TITLES에 적어 주세요. 동음이의 문서는 건너뛰어요.
// - 사진을 못 찾으면 "사진 준비 중" 칸을 보여줘요.
import { useEffect, useState } from "react";
import { loc } from "../lib/i18n.js";

const WIKI_TITLES = {
  simujang: ["심우장"],
  jeongneung: ["서울 정릉", "정릉 (서울)"],
  uiryeong: ["서울 의릉", "의릉"],
  gilsangsa: ["길상사 (서울)"],
};
// 위키백과 대표 이미지가 장소 사진이 아닌 곳 (길상사 문서는 법정 스님 사진)
const NO_WIKI = new Set(["gilsangsa"]);
const cache = new Map();

async function findPhoto(spot) {
  if (NO_WIKI.has(spot.id) || NO_WIKI.has(spot.spot_id)) return null;
  const base = (spot.name?.ko || "").replace(/\s*\(.*\)/, "").trim();
  const titles = [...(WIKI_TITLES[spot.id] || WIKI_TITLES[spot.spot_id] || []), base, `${base} (서울)`].filter(Boolean);
  const url = "https://ko.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1"
    + "&prop=pageimages|pageprops&piprop=thumbnail|name&pithumbsize=900&titles=" + encodeURIComponent([...new Set(titles)].join("|"));
  const json = await (await fetch(url)).json();
  const q = json.query || {};
  // 요청한 이름 → 실제 문서 제목 (정규화·넘겨주기 반영)
  const resolve = (t) => {
    let x = t;
    (q.normalized || []).forEach((n) => { if (n.from === x) x = n.to; });
    (q.redirects || []).forEach((r) => { if (r.from === x) x = r.to; });
    return x;
  };
  const pages = Object.values(q.pages || {});
  for (const t of titles) {
    const page = pages.find((p) => p.title === resolve(t));
    if (!page || page.missing !== undefined || page.pageprops?.disambiguation !== undefined || !page.thumbnail) continue;
    if (/Replace_this_image|\.svg$/i.test(page.pageimage || "")) continue; // "사진 넣어 주세요" 자리표시 그림은 건너뛰어요
    return {
      url: page.thumbnail.source,
      credit: loc({ ko: "사진: 위키미디어 공용", en: "Photo: Wikimedia Commons" }),
      link: page.pageimage ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage)}` : `https://ko.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    };
  }
  return null;
}

export default function PlacePhoto({ spot }) {
  const key = spot.id;
  const [photo, setPhoto] = useState(() => spot.photo || cache.get(key) || null);
  const [state, setState] = useState(photo ? "ok" : "loading");
  useEffect(() => {
    if (spot.photo) { setPhoto(spot.photo); setState("ok"); return; }
    if (cache.has(key)) { const c = cache.get(key); setPhoto(c); setState(c ? "ok" : "none"); return; }
    let alive = true;
    setState("loading");
    findPhoto(spot).then((p) => { cache.set(key, p); if (alive) { setPhoto(p); setState(p ? "ok" : "none"); } })
      .catch(() => { if (alive) setState("none"); });
    return () => { alive = false; };
  }, [key]);

  if (state === "ok" && photo) {
    return (
      <figure className="pd-photo">
        <img src={photo.url} alt={loc(spot.name)} loading="lazy" onError={() => setState("none")} />
        <figcaption><a href={photo.link} target="_blank" rel="noopener">{photo.credit}</a></figcaption>
      </figure>
    );
  }
  return <div className={`pd-photo pd-photo-empty ${state}`} aria-hidden={state === "loading"}>{state === "loading" ? "" : loc({ ko: "대표 사진 준비 중", en: "Photo coming soon" })}</div>;
}
