// 장소 사진을 고르고 보여주는 곳. 모든 화면이 여기를 같이 써요.
// 순서: explore.json의 photo_url(TourAPI) → 데이터의 photo: { url, credit, link } → 위키백과 대표 이미지 → 아이콘·빈 칸
// - 코스 목적지는 explore.json의 같은 장소(spot_id) 사진을 써요.
// - 사진을 못 불러오면 다음 순서로 넘어가요.
// - 공공누리 3유형은 변경 금지라 자르지 않고 contain으로 보여줘요.
// - 위키백과는 화면에 보이는 칸만 조회하고, 결과는 저장해 두고, 동시에 2건까지만 요청해요.
// - 문서 이름이 장소 이름과 다르면 WIKI_TITLES에 적어 주세요. 동음이의 문서는 건너뛰어요.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";

const WIKI_TITLES = {
  simujang: ["심우장"],
  jeongneung: ["서울 정릉", "정릉 (서울)"],
  uiryeong: ["서울 의릉", "의릉"],
  gilsangsa: ["길상사 (서울)"],
};
// 위키백과 대표 이미지가 장소 사진이 아닌 곳: 인물(길상사), 지도(개운산), 다른 그림(한국예술종합학교), 청계천 사진(성북천)
const NO_WIKI = new Set(["gilsangsa", "gaeunsan", "knua", "seongbukcheon"]);
const MAX_WIKI_REQUESTS = 2;
const toHttps = (url) => String(url || "").replace(/^http:\/\//i, "https://");

async function findWiki(spot) {
  if (NO_WIKI.has(spot.id) || NO_WIKI.has(spot.spot_id)) return null;
  const base = (spot.name?.ko || "").replace(/\s*\(.*\)/, "").trim();
  const titles = [...(WIKI_TITLES[spot.id] || WIKI_TITLES[spot.spot_id] || []), base, `${base} (서울)`].filter(Boolean);
  const url = "https://ko.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1"
    + "&prop=pageimages|pageprops&piprop=thumbnail|name&pithumbsize=900&titles=" + encodeURIComponent([...new Set(titles)].join("|"));
  const json = await (await fetch(url)).json();
  const q = json.query || {};
  // 요청한 이름 → 실제 문서 제목 (정규화·넘겨주기 반영)
  const resolve = (name) => {
    let x = name;
    (q.normalized || []).forEach((n) => { if (n.from === x) x = n.to; });
    (q.redirects || []).forEach((r) => { if (r.from === x) x = r.to; });
    return x;
  };
  const pages = Object.values(q.pages || {});
  for (const name of titles) {
    const page = pages.find((p) => p.title === resolve(name));
    if (!page || page.missing !== undefined || page.pageprops?.disambiguation !== undefined || !page.thumbnail) continue;
    if (/Replace_this_image|\.svg$/i.test(page.pageimage || "")) continue; // "사진 넣어 주세요" 자리표시 그림은 건너뛰어요
    return {
      kind: "wiki",
      url: toHttps(page.thumbnail.source),
      link: page.pageimage ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage)}` : `https://ko.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    };
  }
  return null;
}

// 위키백과 조회: 장소마다 한 번만, 동시에 MAX_WIKI_REQUESTS건까지
const wikiCache = new Map();
const waiting = [];
let running = 0;
function pump() {
  while (running < MAX_WIKI_REQUESTS && waiting.length) {
    running++;
    waiting.shift()().finally(() => { running--; pump(); });
  }
}
function wikiPhoto(place) {
  const key = place.spot_id || place.id;
  if (!wikiCache.has(key)) {
    wikiCache.set(key, new Promise((resolve) => {
      waiting.push(() => findWiki(place).then(resolve, () => { wikiCache.delete(key); resolve(null); }));
      pump();
    }));
  }
  return wikiCache.get(key);
}

// 이 장소의 사진 후보를 우선순위대로
export function photoSources(place, data) {
  const linked = place.photo_url ? place : data?.exploreBySpot?.[place.id] || data?.explore?.find((p) => p.id === place.id);
  const list = [];
  if (linked?.photo_url) {
    list.push({ kind: "tour", url: toHttps(linked.photo_url), contain: linked.photo_license === "KOGL-3", credit: linked.photo_credit });
  }
  if (place.photo?.url) list.push({ kind: "data", url: toHttps(place.photo.url), credit: place.photo.credit, link: place.photo.link });
  list.push({ kind: "wiki" });
  return list;
}

function creditText(photo) {
  if (photo.kind === "wiki") return loc({ ko: "사진: 위키미디어 공용", en: "Photo: Wikimedia Commons" });
  if (photo.kind === "tour") return t("photo_credit", { credit: photo.credit });
  return photo.credit;
}

// 지금 보여줄 사진. target을 주면 그 칸이 화면 근처에 올 때 위키백과를 조회해요
function usePhoto(place, target) {
  const { data } = useApp();
  const sources = useMemo(() => photoSources(place, data), [place, data]);
  const [index, setIndex] = useState(0);
  const [wiki, setWiki] = useState(null);
  const [visible, setVisible] = useState(!target);
  const source = sources[index];
  const needsWiki = source?.kind === "wiki";

  useEffect(() => {
    if (!needsWiki || visible) return;
    if (!target.current || !window.IntersectionObserver) { setVisible(true); return; }
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { rootMargin: "200px" });
    io.observe(target.current);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsWiki, visible]);

  useEffect(() => {
    if (!needsWiki || !visible) return;
    let alive = true;
    wikiPhoto(place).then((found) => {
      if (!alive) return;
      if (found) setWiki(found); else setIndex((i) => i + 1);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsWiki, visible]);

  const photo = needsWiki ? wiki : source || null;
  return { photo, loading: needsWiki && !wiki, next: () => { setWiki(null); setIndex((i) => i + 1); } };
}

// 목록 썸네일: 동네 상권 ShopPhoto와 같은 크기·모양. 이름이 바로 옆에 있어서 alt는 비워요
export function PlaceThumb({ place, fallback }) {
  return <Thumb key={place.id} place={place} fallback={fallback} />;
}
function Thumb({ place, fallback }) {
  const target = useRef(null);
  const { photo, next } = usePhoto(place, target);
  if (photo) return <img className={`mk-photo ${photo.contain ? "contain" : ""}`} src={photo.url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={next} />;
  return <span ref={target} className="mk-photo mk-photo-empty" aria-hidden="true">{fallback}</span>;
}

// 카드 위쪽 사진 칸을 채우는 사진
export function PlaceCover({ place, fallback }) {
  return <Cover key={place.id} place={place} fallback={fallback} />;
}
function Cover({ place, fallback }) {
  const target = useRef(null);
  const { photo, next } = usePhoto(place, target);
  return (
    <span ref={target} className="place-cover">
      {photo
        ? <img className={photo.contain ? "contain" : undefined} src={photo.url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={next} />
        : fallback}
    </span>
  );
}

// 상세 화면의 큰 사진. 출처는 여기에만 표시해요. fallback을 주면 사진이 없을 때 "대표 사진 준비 중" 대신 그걸 보여줘요 (null이면 빈 칸)
export default function PlacePhoto({ spot, fallback }) {
  return <Large key={spot.id} spot={spot} fallback={fallback} />;
}
function Large({ spot, fallback }) {
  const { photo, loading, next } = usePhoto(spot);
  if (photo) {
    const credit = creditText(photo);
    return (
      <figure className="pd-photo">
        <img className={photo.contain ? "contain" : undefined} src={photo.url} alt={t("photo_alt", { name: loc(spot.name) })} loading="lazy" referrerPolicy="no-referrer" onError={next} />
        {credit && <figcaption>{photo.link ? <a href={photo.link} target="_blank" rel="noopener">{credit}</a> : <span>{credit}</span>}</figcaption>}
      </figure>
    );
  }
  if (fallback !== undefined) return fallback;
  const state = loading ? "loading" : "none";
  return <div className={`pd-photo pd-photo-empty ${state}`} aria-hidden={loading}>{loading ? "" : loc({ ko: "대표 사진 준비 중", en: "Photo coming soon" })}</div>;
}
