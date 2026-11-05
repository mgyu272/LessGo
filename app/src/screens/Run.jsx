// ⑤ 달리는 중 (디자인 원본 docs/design/Run.dc.html)
// 위: 카카오 지도 — 지나온 길(진한 초록), 남은 코스(흰 선 + 점선), 1km 지점, 목적지, 현재 위치
// 아래: 거리(큰 숫자), "다음 1km까지" 진행 바, 페이스·시간·오르막, 별·쿠폰까지 카드, 음성·일시정지·종료
// 코스 위 500m마다 별이 있어요(주우면 연한 금색). 자유 달리기일 때는 남은 코스·1km 지점·목적지·별 마커를 숨겨요.
// 실제 계산은 state/useRun.js 에 있어요.

import { useMemo, useState } from "react";
import { STAR_RULES } from "../state/useUserData.js";
import { useApp, HOME_CENTER } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { fmtTime, fmtPace, distance } from "../lib/geo.js";
import { MapView, SpotMarker, Route, Me, Follow, FlyTo, KmMark, StarMark } from "../components/MapView.jsx";
import { ConfirmDialog } from "../components/ui.jsx";

export default function Run() {
  const app = useApp();
  const v = app.run.view;
  const { data } = app;
  const c = v?.course;
  const [confirm, setConfirm] = useState(false);
  const [recenter, setRecenter] = useState(null);
  const geo = useCourseGeometry(c);
  const remaining = useMemo(() => remainingPath(geo, v?.me, v?.approach), [geo, v?.me?.[0], v?.me?.[1], v?.approach]);
  if (!v) return null;

  const km = v.meters / 1000;
  const toNext = 1 - (km % 1);
  const dest = c && data.spotById[c.properties.dest];
  const leftKm = c ? Math.max(0, (c.len - v.courseM) / 1000) : 0;
  // 첫 GPS 신호 전에는 코스 출발점(없으면 성북구 중심)을 지도 중심으로 써요
  const mapCenter = v.me || (c ? [c.path[0].lat, c.path[0].lng] : HOME_CENTER);
  const place = dest ? loc(dest.name).replace(/\s*\(.*\)/, "") : "";
  const status = v.paused ? t("run_paused") : c ? t("run_status_course", { name: place, time: fmtTime(v.seconds) }) : t("run_status_free", { time: fmtTime(v.seconds) });
  const per = STAR_RULES.perCoupon;
  const hold = v.starBalance % per;      // 쿠폰까지 모은 별 (10개가 되면 바로 쿠폰으로 바뀌어요)
  const finish = () => { setConfirm(false); app.run.finish(); };

  return (
    <section className={`screen run-screen ${v.paused ? "is-paused" : ""}`}>
      <div className="run-map">
        <MapView zoom={16} center={mapCenter}>
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
        <button className="round-btn glass run-locate" aria-label={t("my_location")} onClick={() => v.me && setRecenter([...v.me])}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" fill="currentColor" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
        </button>
      </div>

      <div className="run-top2">
        <span className="glass run-status"><i className="live" aria-hidden="true" />{status}</span>
        {c && <span className="glass run-left"><PinIcon />{t("run_left", { name: place, km: leftKm.toFixed(1) })}</span>}
      </div>
      {v.cue && <div className="cue">{v.cue}</div>}

      <div className="run-panel2 hanji-sheet">
        <span className="rp-label">{t("distance")}</span>
        <div className="rp-big">{km.toFixed(km < 10 ? 2 : 1)}<em>km</em></div>
        <div className="rp-next">
          <span className="rp-bar"><i style={{ width: `${(1 - toNext) * 100}%` }} /></span>
          <small>{t("to_next_km", { km: toNext.toFixed(2) })}</small>
        </div>
        <div className="rp-stats">
          <div><b>{fmtPace(v.seconds, v.meters)}</b><small>{t("pace")}</small></div>
          <div><b>{fmtTime(v.seconds)}</b><small>{t("time")}</small></div>
          <div><b>+{v.ascent}m</b><small>{t("ascent")}</small></div>
        </div>
        <div className="rp-cards">
          <div className="soft rp-card" aria-live="polite">
            {c ? (
              <>
                <small><StarIcon />{t("course_stars", { got: v.starsGot, total: v.starsTotal })}</small>
                <span><b>{v.nextStarM == null ? t("all_stars") : t("next_star_m", { m: v.nextStarM })}</b></span>
              </>
            ) : (
              <>
                <small><StarIcon />{t("stars_got_n", { n: v.starsGot })}</small>
                <span><b>{t("next_star_free", { m: v.nextStarM })}</b></span>
              </>
            )}
          </div>
          <div className="soft rp-card">
            <small><BagIcon />{t("to_coupon")}</small>
            <span><b>{t("stars_more", { n: per - hold })}</b><em className="rp-hold">{hold}/{per}</em></span>
            <span className="gold-bar" role="progressbar" aria-valuemin={0} aria-valuemax={per} aria-valuenow={hold} aria-label={t("to_coupon")}><i style={{ width: `${(hold / per) * 100}%` }} /></span>
          </div>
        </div>
        <div className="rp-ctl">
          <button className="ctl" aria-pressed={v.voice} onClick={app.run.toggleVoice}>
            <span className="ctl-round">{v.voice ? <VoiceOn /> : <VoiceOff />}</span>{t(v.voice ? "voice_on" : "voice_off")}
          </button>
          <button className="ctl" aria-pressed={v.paused} onClick={app.run.togglePause}>
            <span className="ctl-main">{v.paused ? <PlayBig /> : <PauseBig />}</span>{t(v.paused ? "resume" : "pause")}
          </button>
          <button className="ctl" onClick={() => setConfirm(true)} data-testid="finish">
            <span className="ctl-round"><StopIcon /></span>{t("stop")}
          </button>
        </div>
      </div>

      <ConfirmDialog open={confirm} title={t("stop_title")} cancelLabel={t("stop_cancel")} confirmLabel={t("stop_save")}
        body={t("stop_body_stars", { km: km.toFixed(2), time: fmtTime(v.seconds), n: v.starsGot })}
        onCancel={() => setConfirm(false)} onConfirm={finish} />
    </section>
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
function remainingPath(geo, me, approach) {
  if (!geo.path.length || !me) return [];
  const here = { lat: me[0], lng: me[1] };
  if (approach) return [here, ...geo.path]; // 출발지로 가는 중: 지금 위치 → 출발지 → 코스 전체
  let best = 0, bestD = Infinity;
  geo.path.forEach((q, i) => { const d = distance(q, here); if (d < bestD) { bestD = d; best = i; } });
  return [here, ...geo.path.slice(best + 1)];
}

const PinIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></svg>;
const StarIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="gold"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>;
const BagIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16l-1.5 10a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7z" /><path d="M8 9V7a4 4 0 0 1 8 0v2" /></svg>;
const VoiceOn = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></svg>;
const VoiceOff = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z" /><path d="M17 9l5 6M22 9l-5 6" /></svg>;
const PauseBig = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="fill"><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>;
const PlayBig = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="fill"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10-6.5a1 1 0 0 0 0-1.7l-10-6.5A1 1 0 0 0 8 5.5z" /></svg>;
const StopIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="fill"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>;
