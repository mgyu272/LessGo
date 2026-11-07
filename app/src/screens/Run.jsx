// ⑤ 달리는 중 (디자인 원본 docs/design/Run.dc.html)
// 위: 카카오 지도 — 지나온 길(진한 초록), 남은 코스(흰 선 + 점선), 1km 지점, 목적지, 현재 위치
// 아래: 거리(큰 숫자), "다음 1km까지" 진행 바, 페이스·시간·오르막, 별·쿠폰까지 카드, 음성·일시정지·종료
// 코스 위 500m마다 별이 있어요(주우면 연한 금색). 자유 달리기일 때는 남은 코스·1km 지점·목적지·별 마커를 숨겨요.
// 걷기 모드(v.move === "walk"): 제목 "걸은 거리" + "걷기 모드 · 페이스 없음" 알약, 지표는 시간 · 남은 거리 · 도착 예상(1km 15분).
//   별·쿠폰·음성·일시정지는 달리기와 같아요.
// 안내 배너는 패널 바로 위에 떠요: 100m보다 멀면 작은 칩, 100m 이내면 펼친 배너, 지나면 2초 동안 체크 칩. 일시정지 중에는 진한 배너.
// 종료 버튼은 길게 눌러야(1.2초) 끝나요. 키보드는 Enter/Space를 누르고 있으면 돼요.
// 실제 계산은 state/useRun.js 에 있어요.

import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { fmtTime, fmtPace, distance } from "../lib/geo.js";
import { MapView, SpotMarker, Route, Me, Follow, FlyTo, KmMark, StarMark } from "../components/MapView.jsx";
import { minutesFor, durText } from "../lib/routes.js";

const CUE_NEAR_M = 100;  // 이 안으로 들어오면 안내를 펼쳐요
const HOLD_MS = 1200;    // 종료 버튼을 누르고 있어야 하는 시간
const HOLD_HINT_MS = 1600;
const STAR_ICONS = 10;   // 코스 길이와 관계없이 진행도를 10칸에 표시해요

export default function Run() {
  const app = useApp();
  const v = app.run.view;
  const { data } = app;
  const c = v?.course;
  const [recenter, setRecenter] = useState(null);
  const geo = useCourseGeometry(c);
  const remaining = useMemo(() => remainingPath(geo, v?.me), [geo, v?.me?.[0], v?.me?.[1]]);
  if (!v) return null;

  const km = v.meters / 1000;
  const toNext = 1 - (km % 1);
  const dest = c && data.spotById[c.properties.dest];
  const leftKm = c ? Math.max(0, (c.len - v.meters) / 1000) : 0;
  const place = dest ? loc(dest.name).replace(/\s*\(.*\)/, "") : "";
  const walk = v.move === "walk";
  const status = v.paused ? t("run_paused")
    : c ? t(walk ? "walk_status" : "run_status_course", { name: place, time: fmtTime(v.seconds) })
    : t("run_status_free", { time: fmtTime(v.seconds) });

  return (
    <section className={`screen run-screen ${v.paused ? "is-paused" : ""}`}>
      <div className="run-map">
        <MapView zoom={16} center={v.me}>
          {c && remaining.length > 1 && [
            <Route key="rem-case" path={remaining} color="#FFFFFF" weight={11} opacity={0.95} />,
            <Route key="rem" path={remaining} color="#9FD25E" weight={4} opacity={1} dashed />,
          ]}
          {v.trail.length > 1 && [
            <Route key="trail-case" path={v.trail} color="#FFFFFF" weight={11} opacity={1} />,
            <Route key="trail" path={v.trail} color="#2F6512" weight={6} opacity={1} />,
          ]}
          {c && geo.marks.map((m) => <KmMark key={m.km} at={m.at} label={`${m.km}km`} />)}
          {c && v.stars.map((st, i) => <StarMark key={i} at={st.at} got={st.got} />)}
          {dest && <SpotMarker spot={dest} />}
          <Me at={v.me} />
          <Follow pos={v.me} />{/* 내 위치를 따라 지도 이동 */}
          <FlyTo to={recenter} level={3} />
        </MapView>
        <button className="round-btn glass run-locate" aria-label={t("my_location")} onClick={() => setRecenter([...v.me])}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" fill="currentColor" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
        </button>
      </div>

      <div className="run-top2">
        <span className="glass run-status"><i className="live" aria-hidden="true" />{status}</span>
        {c && <span className="glass run-left"><PinIcon />{t("run_left", { name: place, km: leftKm.toFixed(1) })}</span>}
      </div>
      <CueArea v={v} />

      <div className="run-panel2 hanji-sheet">
        <span className="rp-label">{t(walk ? "walked_dist" : "distance")}{walk && <em className="rp-walk">{t("walk_pill")}</em>}</span>
        <div className="rp-big">{km.toFixed(km < 10 ? 2 : 1)}<em>km</em></div>
        <div className="rp-next">
          <span className="rp-bar"><i style={{ width: `${(1 - toNext) * 100}%` }} /></span>
          <small>{t("to_next_km", { km: toNext.toFixed(2) })}</small>
        </div>
        {walk ? (
          // 걷기: 페이스 대신 남은 거리와 도착 예상 시간
          <div className="rp-stats">
            <div><b>{fmtTime(v.seconds)}</b><small>{t("time")}</small></div>
            <div><b>{c ? `${leftKm.toFixed(1)}km` : "—"}</b><small>{t("dist_left")}</small></div>
            <div><b>{c ? durText(minutesFor(leftKm, "walk")) : "—"}</b><small>{t("eta")}</small></div>
          </div>
        ) : (
          <div className="rp-stats">
            <div><b>{fmtPace(v.seconds, v.meters)}</b><small>{t("pace")}</small></div>
            <div><b>{fmtTime(v.seconds)}</b><small>{t("time")}</small></div>
            <div><b>+{v.ascent}m</b><small>{t("ascent")}</small></div>
          </div>
        )}
        <div className="rp-cards">
          <StarCard v={v} />
          <TempCard earned={app.user.starsEarned || 0} />
        </div>
        <RunControls v={v} walk={walk} run={app.run} />
      </div>
    </section>
  );
}

// 안내 배너 자리. 읽어 주기 프로그램이 숫자가 바뀔 때마다 읽지 않도록, 보이는 거리는 숨기고 안내 문구만 알려요
function CueArea({ v }) {
  const next = v.nextCue;
  const [choice, setChoice] = useState({}); // 안내별 선택: "open" 미리 펼침 · "closed" 접음
  const set = (i, value) => setChoice((old) => ({ ...old, [i]: value }));

  let body = null, spoken = "";
  if (v.paused) {
    spoken = `${t("run_paused_title")}. ${t("run_paused_sub")}`;
    body = (
      <div className="cue-banner dark">
        <span className="cue-box"><PauseBig /></span>
        <span className="cue-text"><b>{t("run_paused_title")}</b><small>{t("run_paused_sub")}</small></span>
      </div>
    );
  } else if (v.cueDone) {
    spoken = t(`cue_done_${v.cueDone.dir}`);
    body = (
      <div className="cue-chip done">
        <span className="cue-dot"><CheckIcon /></span>
        <span>{spoken}</span>
      </div>
    );
  } else if (v.cue) {
    spoken = v.cue;
    body = (
      <div className="cue-banner">
        <span className="cue-box"><CheckIcon /></span>
        <span className="cue-text"><small>{v.cue}</small></span>
      </div>
    );
  } else if (next) {
    spoken = next.text;
    const picked = choice[next.i];
    const open = picked === "open" || (picked !== "closed" && next.m <= CUE_NEAR_M);
    body = open ? (
      <div className="cue-banner" key={next.i}>
        <span className="cue-box"><CueArrow dir={next.dir} /></span>
        <span className="cue-text" aria-hidden="true">
          <b>{t(`cue_big_${next.dir}`, { m: next.m })}</b>
          <small>{next.text}</small>
        </span>
        <button type="button" className="cue-fold" onClick={() => set(next.i, "closed")} aria-label={t("cue_fold")}><ChevronDown /></button>
        <span className="cue-bar" aria-hidden="true"><i style={{ width: `${Math.min(1, next.m / CUE_NEAR_M) * 100}%` }} /></span>
      </div>
    ) : (
      <button type="button" className="cue-chip" onClick={() => set(next.i, "open")} aria-label={t("cue_unfold", { text: next.text })}>
        <span className="cue-dot"><CueArrow dir={next.dir} /></span>
        <span>{t(`cue_chip_${next.dir}`, { m: Math.max(10, Math.round(next.m / 10) * 10) })}</span>
      </button>
    );
  }
  if (!body) return <div className="cue-area" role="status" aria-live="polite" />;
  return (
    <div className="cue-area" role="status" aria-live="polite">
      <span className="sr-only">{spoken}</span>
      <div aria-hidden={v.paused || v.cueDone || v.cue ? true : undefined}>{body}</div>
    </div>
  );
}

export function StarCard({ v }) {
  if (!v.course) {
    return (
      <div className="rp-card">
        <small>{t("stars_got_n", { n: v.starsGot })}</small>
        <p className="rp-line"><strong>{t("next_star_free", { m: v.nextStarM })}</strong></p>
      </div>
    );
  }
  const total = v.starsTotal;
  const filled = total ? Math.round((v.starsGot / total) * STAR_ICONS) : 0;
  return (
    <div className="rp-card">
      <small>{t("course_stars_label")}</small>
      <b className="rp-num">{v.starsGot}<em>/{total}</em></b>
      <span className="rp-stars" aria-hidden="true">
        {Array.from({ length: STAR_ICONS }, (_, i) => <StarGlyph key={i} on={i < filled} />)}
      </span>
      <p className="rp-line">{v.nextStarM == null ? t("all_stars") : <>{t("next_star_to")} <strong>{v.nextStarM}m</strong></>}</p>
    </div>
  );
}

function TempCard({ earned }) {
  const temp = Math.min(99.9, 36.5 + earned * 0.15);
  return (
    <div className="rp-card">
      <small>{t("runner_temp")}</small>
      <b className="rp-num">{temp.toFixed(1)}<em>°C</em></b>
      <span className="rp-gauge" aria-hidden="true"><i style={{ left: `${((temp - 36.5) / (99.9 - 36.5)) * 100}%` }} /></span>
      <p className="rp-line">{t("runner_temp_hint")}</p>
    </div>
  );
}

// 음성 · 일시정지 · 길게 눌러 종료
function RunControls({ v, walk, run }) {
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const active = useRef(false);
  const timer = useRef(null);
  const hintTimer = useRef(null);
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(hintTimer.current); }, []);

  const begin = () => {
    if (active.current) return;
    active.current = true;
    clearTimeout(hintTimer.current);
    setHint(false);
    setHolding(true);
    timer.current = setTimeout(() => { active.current = false; setHolding(false); run.finish(); }, HOLD_MS);
  };
  const cancel = () => {
    if (!active.current) return;
    active.current = false;
    clearTimeout(timer.current);
    setHolding(false);
    setHint(true);
    hintTimer.current = setTimeout(() => setHint(false), HOLD_HINT_MS);
  };
  const isHoldKey = (e) => e.key === "Enter" || e.key === " ";

  return (
    <div className="rp-ctl">
      <div className="rp-ctl-row">
        <button type="button" className="ctl-round" aria-label={t(v.voice ? "voice_on" : "voice_off")} aria-pressed={v.voice} onClick={run.toggleVoice}>
          {v.voice ? <VoiceOn /> : <VoiceOff />}
        </button>
        <button type="button" className={`ctl-main ${v.paused ? "paused" : ""}`} aria-label={t(v.paused ? "resume" : "pause")} aria-pressed={v.paused} onClick={run.togglePause}>
          {v.paused ? <PlayBig /> : <PauseBig />}
        </button>
        <span className={`ctl-end-wrap ${holding ? "holding" : ""}`}>
          <svg className="ctl-ring" viewBox="0 0 60 60" aria-hidden="true">
            <circle className="track" cx="30" cy="30" r="28.5" />
            <circle className="fill" cx="30" cy="30" r="28.5" pathLength="100" />
          </svg>
          <button type="button" className="ctl-end" aria-label={t(walk ? "hold_finish_walk_aria" : "hold_finish_aria")} data-testid="finish"
            onPointerDown={(e) => { if (e.button === 0) { e.currentTarget.setPointerCapture?.(e.pointerId); begin(); } }}
            onPointerUp={cancel} onPointerCancel={cancel} onBlur={cancel} onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => { if (isHoldKey(e)) { e.preventDefault(); if (!e.repeat) begin(); } }}
            onKeyUp={(e) => { if (isHoldKey(e)) { e.preventDefault(); cancel(); } }}>
            <StopIcon />
          </button>
        </span>
      </div>
      <div className="rp-ctl-labels" aria-hidden="true">
        <span>{t(v.voice ? "voice_on" : "voice_off")}</span>
        <span>{t(v.paused ? "resume" : "pause")}</span>
        <span className="end">{t(hint ? "hold_more" : "hold_finish")}</span>
      </div>
    </div>
  );
}

// 코스 선의 누적 거리와 1km 지점들
function useCourseGeometry(course) {
  return useMemo(() => {
    if (!course) return { path: [], cum: [], marks: [] };
    const path = course.path, cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + distance(path[i - 1], path[i]));
    const marks = [];
    for (let k = 1; k * 1000 < cum[cum.length - 1] - 100; k++) {
      const at = k * 1000;
      const i = cum.findIndex((d) => d >= at);
      const a = path[i - 1], b = path[i], f = (at - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      marks.push({ km: k, at: [a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f] });
    }
    return { path, cum, marks };
  }, [course]);
}

// 남은 코스: 지금 위치에서 가장 가까운 코스 점부터 끝까지
function remainingPath(geo, me) {
  if (!geo.path.length || !me) return [];
  const here = { lat: me[0], lng: me[1] };
  let best = 0, bestD = Infinity;
  geo.path.forEach((q, i) => { const d = distance(q, here); if (d < bestD) { bestD = d; best = i; } });
  return [here, ...geo.path.slice(best + 1)];
}

const PinIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>;
const StarGlyph = ({ on }) => <svg viewBox="0 0 24 24" className={on ? "on" : ""}><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>;
// 방향 화살표: 왼쪽은 오른쪽 그림을 좌우 반전해요
const CueArrow = ({ dir }) => (dir === "straight"
  ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5M6 11l6-6 6 6" /></svg>
  : <svg viewBox="0 0 24 24" aria-hidden="true" className={dir === "left" ? "flip" : ""}><path d="M6 20v-7a4 4 0 0 1 4-4h9M14 4l5 5-5 5" /></svg>);
const CheckIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const ChevronDown = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>;
const BagIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16l-1.5 10a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7z" /><path d="M8 9V7a4 4 0 0 1 8 0v2" /></svg>;
const VoiceOn = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>;
const VoiceOff = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9l5 6M22 9l-5 6" /></svg>;
const PauseBig = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="fill"><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>;
const PlayBig = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="fill"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z" /></svg>;
const StopIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="fill"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>;
