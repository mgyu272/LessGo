// ⑥-1 달리기 완주 요약 (디자인 원본 docs/design/RunDone.dc.html)
// 자유 달리기를 마쳤거나, 코스를 목적지 전에 끝냈을 때 보여줘요.
// 지도 카드 + 거리·시간·페이스, 모은 별·내 별·쿠폰, 쿠폰까지 진행(또는 받은 쿠폰), 지나간 길 근처 이야기, 하단 고정 버튼

import { useMemo } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { fmtTime, fmtPace, distance } from "../lib/geo.js";
import { MapView, FitBounds, Route } from "../components/MapView.jsx";
import { StarProgress, CouponItem } from "../components/StarCoupons.jsx";
import { LogoBird } from "../components/LogoBird.jsx";
import { spotIconSvg } from "../components/SpotIcons.jsx";

const NEAR_TRAIL_M = 500; // 지나간 길에서 이 거리 안의 장소를 "근처 이야기"로 보여줘요

export default function RunDone() {
  const app = useApp();
  const f = app.finish;
  const r = f?.record;
  const nearby = useMemo(() => (f ? spotsNearTrail(f.trail, app.data.spots) : []), [f, app.data.spots]);
  if (!f) return null;

  const share = async () => {
    const text = `${loc(r.name)} · ${(r.meters / 1000).toFixed(2)}km · ${fmtTime(r.seconds)} · ★${f.starsGot} — LessGo`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); app.toast(t("shared")); }
    } catch {}
  };
  const openPlace = (spot) => { app.setSpot(spot); app.go("place"); };
  const title = f.course ? loc(f.course.properties.title || f.course.properties.name) : t("done_free");
  // 완주 아이콘: 코스 목적지 장소 아이콘 (자유 달리기는 로고)
  const destSpot = f.course && app.data.spotById?.[f.course.properties.dest];

  return (
    <section className="screen done-screen">
      <div className="hanji-layer" aria-hidden="true" />
      <div className="done-scroll">
        <div className="done-head">
          {destSpot
            ? <span className="done-stamp done-place" role="img" aria-label={loc(destSpot.name)} dangerouslySetInnerHTML={{ __html: spotIconSvg(destSpot) }} />
            : <span className="done-stamp" role="img" aria-label="LessGo"><LogoBird variant="icon" size={60} /></span>}
          <div><span className="kicker2">{t("todays_run")}</span><h1>{title}</h1></div>
        </div>

        <div className="card done-map">
          <div className="dm-map">
            <MapView>
              {f.trail.length > 1 && [
                <Route key="c" path={f.trail} color="#FFFFFF" weight={10} opacity={1} />,
                <Route key="t" path={f.trail} color="#2F6512" weight={5} opacity={1} />,
              ]}
              <FitBounds points={f.trail.length ? f.trail : [[37.59, 127.0]]} fitKey={r.id} />
            </MapView>
          </div>
          <div className="dm-stats">
            <div><b>{(r.meters / 1000).toFixed(2)}km</b><small>{t("distance")}</small></div>
            <div><b>{fmtTime(r.seconds)}</b><small>{t("time")}</small></div>
            <div><b>{fmtPace(r.seconds, r.meters)}</b><small>{t("pace")}</small></div>
          </div>
        </div>

        <div className="done-earn">
          <div className="soft"><span><StarIcon />+{f.starsGot}</span><small>{t("stars_collected")}</small></div>
          <div className="soft"><span><StarIcon />{app.user.bonus}</span><small>{t("my_stars_now")}</small></div>
          <div className="soft"><span><BagIcon />{f.coupons.length}</span><small>{t("coupons")}</small></div>
        </div>

        {/* 이번에 쿠폰이 생겼으면 받은 쿠폰, 아니면 쿠폰까지 진행 */}
        {f.coupons.length > 0 ? (
          <section className="card done-coupon2" aria-label={t("coupon_one_got")}>
            <h2>{t("coupon_one_got")}</h2>
            {f.coupons.map((c) => <CouponItem key={c.id} coupon={c} />)}
          </section>
        ) : (
          <section className="card done-coupon2"><StarProgress balance={app.user.bonus} /></section>
        )}

        {nearby.length > 0 && (
          <section className="done-near" aria-label={t("near_stories")}>
            <h2>{t("near_stories")}</h2>
            {nearby.map(({ s, d }) => (
              <button key={s.id} className="card dn-card" onClick={() => openPlace(s)}>
                <span className="dn-ic" aria-hidden="true" dangerouslySetInnerHTML={{ __html: spotIconSvg(s) }} />
                <span className="dn-text"><b>{loc(s.name)}</b><small>{t("near_m", { m: Math.round(d) })}</small></span>
                <svg className="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            ))}
          </section>
        )}

      </div>

      <div className="done-cta">
        <button className="btn btn-cta" onClick={share}><ShareIcon />{t("share_card")}</button>
        <button className="btn btn-soft" onClick={() => app.go("home")}>{t("back_to_map")}</button>
      </div>
    </section>
  );
}

function spotsNearTrail(trail, spots) {
  if (!trail?.length) return [];
  return spots.map((s) => {
    let best = Infinity;
    trail.forEach(([lat, lng]) => { const d = distance({ lat, lng }, s); if (d < best) best = d; });
    return { s, d: best };
  }).filter((x) => x.d <= NEAR_TRAIL_M).sort((a, b) => a.d - b.d);
}

const StarIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="fill"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></svg>;
const BagIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h16l-1.5 10a2 2 0 0 1-2 1.7h-9a2 2 0 0 1-2-1.7z" /><path d="M8 9V7a4 4 0 0 1 8 0v2" /></svg>;
const ShareIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true" className="share"><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></svg>;
