// ⑦ 이야기 탭 = 로그인 뒤 메인 화면
// 맨 위 AI 역사 렌즈 카드("사진으로 물어보기" → 장소 고르기 → 그 장소 상세의 AI 역사 렌즈 탭)
// 아래 이야기 3편: 코스 목적지(심우장·정릉·의릉) 사진 카드를 옆으로 넘겨 봐요 (도장 + 질문형 제목 spots.json hook + "이야기 듣기" / "여기로 달리기")
// 둘러볼 곳·카테고리·지도는 장소 탭(PlacesHub.jsx)에 있어요.

import { useEffect, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { DESTINATIONS } from "../lib/routes.js";
import { destName } from "../lib/places.js";
import { Seal, sealText } from "../components/Bits.jsx";
import { Brand } from "../components/LogoBird.jsx";
import { PlaceCover } from "../components/PlacePhoto.jsx";

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

  return (
    <section className="screen places-screen st-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="places-scroll">
        <div className="ph-head">
          <h1 className="st-brand" aria-label={t("st_brand_label")}><Brand size={40} name="성북런" subtitle={false} /></h1>
          <p>{t("st_sub", { n: stories.length })}</p>
        </div>

        <section className="st-lens" aria-labelledby="st-lens-title">
          <span className="st-lens-label"><LensIcon />{t("pd_tab_history_lens")}</span>
          <h2 id="st-lens-title">{t("st_lens_title1")}<br />{t("st_lens_title2")}</h2>
          <div className="st-lens-steps">
            <span>{t("st_lens_step1")}</span>
            <span>{t("st_lens_step2")}</span>
          </div>
          <button type="button" ref={askBtn} className="st-lens-btn" onClick={() => setAsk(true)} aria-haspopup="dialog">
            <CameraIcon />{t("st_lens_ask")}
          </button>
        </section>

        <div className="st-head">
          <h2>{t("st_stories_n", { n: stories.length })}</h2>
          <p>{t("st_stories_sub")}</p>
        </div>

        <DestCarousel key={app.lang} items={stories} label={t("st_stories_n", { n: stories.length })} render={(s, i) => (
          <article className="pl-card">
            <div className="pl-card-photo">
              <PlaceCover place={s} fallback={<PhotoIcon />} />
              <span className="pl-course-count">{t("courses_n", { n: data.courses.filter((c) => c.properties.dest === s.id).length })}</span>
              <span className="pl-ic" aria-hidden="true"><Seal text={sealText(s)} size={46} /></span>
            </div>
            <div className="pl-text">
              <small>{t("st_story_no", { i: i + 1, name: destName(data, s.id) })}</small>
              <h3>{loc(s.hook) || loc(s.name)}</h3>
              {s.hook_meta && <p>{loc(s.hook_meta)}</p>}
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

      {ask && <AskSheet stories={stories} onClose={closeAsk} onPick={(s) => openPlace(s, "history_lens")} />}
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

function PhotoIcon() {
  return <svg width="38" height="38" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/></svg>;
}

// "어느 장소에서 찍었나요?" 작은 창 (아래에서 올라와요). 바깥 누르기 · 닫기 · Esc로 닫혀요
function AskSheet({ stories, onClose, onPick }) {
  const { data } = useApp();
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
        <h2 id="st-ask-title">{t("st_ask_where")}</h2>
        <div className="st-ask-list">
          {stories.map((s, i) => (
            <button key={s.id} ref={i === 0 ? first : undefined} type="button" className="st-ask-place" onClick={() => onPick(s)}>
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
