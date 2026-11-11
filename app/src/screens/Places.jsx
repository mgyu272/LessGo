// ⑦ 이야기 탭 = 로그인 뒤 메인 화면
// 맨 위 AI 역사 렌즈 카드("사진으로 물어보기" → 장소 고르기 → 그 장소 상세의 AI 역사 렌즈 탭)
// 아래 추천 코스 3선: 코스 목적지(심우장·정릉·의릉) 사진 카드를 옆으로 넘겨 봐요 (빨간 도장 + 큰 장소 이름 + 작은 질문 spots.json hook + 누가 살았는지 hook_meta + "이야기 듣기" / "여기로 달리기")
// 둘러볼 곳·카테고리·지도는 장소 탭(PlacesHub.jsx)에 있어요.

import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { DESTINATIONS } from "../lib/routes.js";
import { destName } from "../lib/places.js";
import { Seal, sealText } from "../components/Bits.jsx";
import { Brand } from "../components/LogoBird.jsx";
import { PlaceCover } from "../components/PlacePhoto.jsx";
import { TEST_PHOTOS } from "../lib/testPhotos.js";

export default function Places() {
  const app = useApp();
  const { data } = app;
  const stories = DESTINATIONS.map((id) => data.spotById[id]).filter(Boolean);
  const [ask, setAsk] = useState(false);
  const askBtn = useRef(null);

  // 장소 상세를 원하는 탭으로 열어요 (story · history_lens)
  const openPlace = (s, tab) => { app.placeTab.current = tab; app.setSpot(s); app.setPlaceFrom("places"); app.go("place"); };
  const runHere = (s) => { app.setPick({ ...app.pick, dest: s.id }); app.go("courses"); };
  const closeAsk = () => { setAsk(false); askBtn.current?.focus(); };
  // 카메라를 못 쓰는 환경(데스크톱 · 권한 거부 · 카메라 없음)이면 장소 고르기 창에 테스트 사진을 먼저 보여줘요
  const openAsk = () => setAsk(true);
  // 테스트 사진을 고르면 그 장소의 AI 역사 렌즈를 열고 바로 분석해요
  const pickTest = (p) => {
    const s = data.spotById[p.spotId];
    if (!s) return;
    app.lensTest.current = p.id;
    openPlace(s, "history_lens");
  };

  return (
    <section className="screen places-screen st-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll">
        <div className="ph-head">
          <h1 className="st-brand" aria-label={t("st_brand_label")}><Brand size={40} name="성북런" subtitle={false} /></h1>
        </div>

        <section className="st-lens" aria-labelledby="st-lens-title">
          {/* 심우장 사진 위에 AI가 단서를 찾는 모습: 네 귀퉁이 꺾쇠 · 칩 2개 · 현판/대문 점선 박스 · 가운데 스캔 선 */}
          <div className="st-lens-photo">
            <PlaceCover place={data.spotById.simujang} fallback={<PhotoIcon />} />
            <span className="st-lens-corner tl" aria-hidden="true" />
            <span className="st-lens-corner tr" aria-hidden="true" />
            <span className="st-lens-corner bl" aria-hidden="true" />
            <span className="st-lens-corner br" aria-hidden="true" />
            <span className="st-lens-box st-lens-box-plaque" aria-hidden="true"><span className="st-lens-tag">{t("st_lens_tag_plaque")}</span></span>
            <span className="st-lens-box st-lens-box-gate" aria-hidden="true"><span className="st-lens-tag light">{t("st_lens_tag_gate")}</span></span>
            <span className="st-lens-scan" aria-hidden="true" />
            <span className="st-lens-chip st-lens-chip-left"><i aria-hidden="true" />{t("pd_tab_history_lens")}</span>
            <span className="st-lens-chip st-lens-chip-right">{t("st_lens_flow")}</span>
          </div>
          <div className="st-lens-body">
            <div className="st-lens-copy">
              <h2 id="st-lens-title">{t("st_lens_title")}</h2>
              <p>{t("st_lens_desc")}</p>
            </div>
            {/* 손가락이 다가와 버튼을 꾹 누르는 안내 애니메이션 (손가락은 누르기를 막지 않아요) */}
            <span className="st-lens-btn-wrap">
              <span className="st-lens-ripple" aria-hidden="true" />
              <button type="button" ref={askBtn} className="st-lens-btn" onClick={openAsk} aria-haspopup="dialog" aria-label={t("st_lens_ask")}>
                <CameraIcon />
              </button>
              <FingerIcon />
            </span>
          </div>
        </section>

        <div className="st-head">
          <h2>{t("dest_title")}</h2>
          <p>{t("dest_description")}</p>
        </div>

        <DestCarousel key={app.lang} items={stories} label={t("dest_title")} render={(s, i) => (
          <article className="pl-card">
            <div className="pl-card-photo">
              <CoursePhoto spot={s} />
              <span className="pl-course-count">{t("courses_n", { n: data.courses.filter((c) => c.properties.dest === s.id).length })}</span>
              <span className="pl-seal" aria-hidden="true"><Seal text={sealText(s)} size={28} /></span>
            </div>
            <div className="pl-text">
              <h3>{destName(data, s.id)}</h3>
              {s.hook && <p className="pl-hook">{loc(s.hook)}</p>}
              {s.hook_meta && <p className="pl-who">{loc(s.hook_meta)}</p>}
            </div>
            <div className="pl-actions">
              <button type="button" className="st-btn-listen" onClick={() => openPlace(s, "story")}
                aria-label={t("st_listen_label", { name: destName(data, s.id) })}>
                <span aria-hidden="true">▶</span>{t("st_listen")}
              </button>
              <button type="button" className="st-btn-run" onClick={() => runHere(s)}
                aria-label={t("dest_run_label", { name: loc(s.name) })}>{t("run_here")} →</button>
            </div>
          </article>
        )} />
      </div>

      {ask && <AskSheet stories={stories} onClose={closeAsk} onPick={(s) => openPlace(s, "history_lens")} onPickTest={pickTest} />}
    </section>
  );
}

// 코스 목적지 카드: 손으로 쓸어 한 장씩 넘기는 캐러셀 (터치·트랙패드는 브라우저 스크롤, 마우스는 끌기).
// 옆 카드가 살짝 보이고, 아래 점으로 지금 몇 번째인지 보여줘요
function DestCarousel({ items, render, label }) {
  const n = items.length;
  const [idx, setIdx] = useState(0);
  const track = useRef(null);
  const drag = useRef(null);
  const moved = useRef(false);
  const step = () => { const el = track.current; if (!el) return 1; const slide = el.querySelector(".dc-slide"); return slide ? slide.offsetWidth + 10 : el.clientWidth; };
  const go = (k) => { const el = track.current; if (!el) return; const t = Math.max(0, Math.min(n - 1, k)); el.scrollTo({ left: t * step(), behavior: "smooth" }); setIdx(t); };
  const onScroll = () => { const el = track.current; if (!el || drag.current) return; setIdx(Math.max(0, Math.min(n - 1, Math.round(el.scrollLeft / step())))); };
  // 마우스로 끌기 (데스크톱 화면에서 쓸어넘기기처럼)
  const down = (e) => { if (e.pointerType !== "mouse" || n < 2) return; drag.current = { x: e.clientX, left: track.current.scrollLeft, id: e.pointerId }; moved.current = false; };
  const move = (e) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x;
    if (!moved.current && Math.abs(dx) > 6) { moved.current = true; track.current.classList.add("dragging"); track.current.setPointerCapture?.(d.id); }
    if (moved.current) track.current.scrollLeft = d.left - dx;
  };
  const up = (e) => {
    const d = drag.current; drag.current = null; if (!d) return;
    track.current.classList.remove("dragging");
    if (!moved.current) return;
    const dx = e.clientX - d.x, base = Math.round(d.left / step());
    go(dx < -40 ? base + 1 : dx > 40 ? base - 1 : base);
  };
  const stopClick = (e) => { if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; } };
  const key = (e) => { if (e.key === "ArrowRight") go(idx + 1); if (e.key === "ArrowLeft") go(idx - 1); };

  return (
    <div className="dc" role="region" aria-roledescription="carousel" aria-label={label} tabIndex={0} onKeyDown={key}>
      <div className="dc-track" ref={track} onScroll={onScroll}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClickCapture={stopClick}>
        {items.map((it, k) => (
          <div key={k} className={`dc-slide ${k === idx ? "on" : ""}`} aria-hidden={k !== idx}
            onClickCapture={k !== idx ? (e) => { e.stopPropagation(); e.preventDefault(); go(k); } : undefined}>
            {render(it, k)}
          </div>
        ))}
      </div>
      {n > 1 && (
        <div className="dc-dots" aria-hidden="true">
          {items.map((_, k) => <span key={k} className={k === idx ? "on" : ""} />)}
        </div>
      )}
    </div>
  );
}

// 추천 코스 카드 사진: public/test-photos의 심우장·정릉·의릉 사진, 없으면 장소 자료 사진
function CoursePhoto({ spot }) {
  return <PlaceCover place={spot} fallback={<PhotoIcon />} />;
}

// 렌즈 카드의 흰 손가락(포인터)
function FingerIcon() {
  return (
    <svg className="st-lens-finger" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
      <path d="M6 14V4a2 2 0 014 0v5a2 2 0 014 0v1a2 2 0 014 0v1a2 2 0 014 0v3a8 8 0 01-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 012.83-2.82L6 15z"
        fill="#FFFFFF" stroke="#1F3D14" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 9v2.5M14 10v1.5M18 11v1.5" fill="none" stroke="#1F3D14" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PhotoIcon() {
  return <svg width="38" height="38" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg>;
}

// "어느 장소에서 찍었나요?" 작은 창 (아래에서 올라와요). 바깥 누르기 · 닫기 · Esc로 닫혀요
function AskSheet({ stories, onClose, onPick, onPickTest }) {
  const { data, lang } = useApp();
  const first = useRef(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ui-layer">
      <div className="ui-scrim" onClick={onClose} />
      <section className="ui-optsheet hanji-sheet rise st-ask" role="dialog" aria-modal="true" aria-labelledby="st-ask-title">
        <span className="grip" aria-hidden="true" />
        {(
          <div className="st-ask-test">
            <p>{lang === "ko" ? "현장에 가지 않아도 AI 역사 렌즈를 체험할 수 있어요. 아래 예시 사진을 선택하면 실제 AI 분석을 시작합니다." : "Try the AI History Lens without visiting the site. Choose a sample photo to start a live AI analysis."}</p>
            <div className="st-ask-test-list">
              {TEST_PHOTOS.map((p, i) => {
                const name = p.name[lang === "ko" ? "ko" : "en"];
                return (
                  <button key={p.id} ref={i === 0 ? first : undefined} type="button" className="st-ask-test-btn"
                    onClick={() => onPickTest(p)} aria-label={t("lens_test_pick", { name })}>
                    <img src={p.src} alt="" />
                    <span>{name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <h2 id="st-ask-title">{t("st_ask_where")}</h2>
        <div className="st-ask-list">
          {stories.map((s, i) => (
            <button key={s.id} ref={undefined}type="button" className="st-ask-place" onClick={() => onPick(s)}>
              <Seal text={sealText(s)} size={36} />
              <b>{destName(data, s.id)}</b>
              <span aria-hidden="true">›</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-soft" onClick={onClose}>{t("close")}</button>
      </section>
    </div>
  );
}

// 뷰파인더 + 반짝이
export function LensIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8V5a2 2 0 012-2h3 M16 3h3a2 2 0 012 2v3 M21 16v3a2 2 0 01-2 2h-3 M8 21H5a2 2 0 01-2-2v-3" />
      <path d="M12 7.5l1.2 3.3 3.3 1.2-3.3 1.2L12 16.5l-1.2-3.3L7.5 12l3.3-1.2z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" /><circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

// 위치 권한이 이미 허용돼 있을 때만 내 위치를 써요 (이 화면에서 권한 창을 새로 띄우지 않아요). 모르면 거리 표시를 숨겨요
// 상권 탭(Market.jsx)에서 써요
export function useKnownPosition() {
  const [here, setHere] = useState(null);
  useEffect(() => {
    let alive = true;
    navigator.permissions?.query({ name: "geolocation" }).then((p) => {
      if (p.state !== "granted" || !alive) return;
      navigator.geolocation.getCurrentPosition((pos) => alive && setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude }), () => {}, { maximumAge: 60000, timeout: 8000 });
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return here;
}
