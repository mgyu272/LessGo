// ⑤ 달리기 (시안 5·7번): 어두운 지도, 다음 스팟까지 거리, 음성 안내 배너, 육각형 +칸
// 실제 계산은 state/useRun.js 에 있어요. 여기는 보여주기만 해요.

import { useApp } from "../state/AppContext.jsx";
import { t } from "../lib/i18n.js";
import { useMemo } from "react";
import { fmtTime, fmtPace, distance } from "../lib/geo.js";
import { MapView, FitBounds, HexLayer, SpotMarker, Route, Dot, Me, Follow } from "../components/MapView.jsx";
import { ShopRow } from "../components/Bits.jsx";
import { Polyline } from "react-leaflet";

export default function Run() {
  const app = useApp();
  const v = app.run.view;
  const { data } = app;
  const c = v?.course;
  const spots = useMemo(() => (c ? c.properties.spots.map((id) => data.spotById[id]).filter(Boolean) : data.spots), [c, data]);
  const ticks = useSpotTicks(c, spots);
  if (!v) return null;
  const openCoupon = (shop) => { app.setCouponShop(shop); app.go("coupon"); };

  return (
    <section className="screen dark">
      <MapView dark zoom={16} center={v.me}>
        <HexLayer cells={app.user.cells} landmarkCells={data.landmarkCells} dark fresh={v.fresh} />
        {c && <Route path={c.path} color="#7CC4A4" />}
        {!c && data.shops.filter((s) => s.partner).map((s) => <Dot key={s.id} at={[s.lat, s.lng]} color="#ECB22E" radius={8} />)}
        {spots.map((s) => <SpotMarker key={s.id} spot={s} />)}
        {v.trail.length > 1 && <Polyline positions={v.trail} pathOptions={{ color: "#fff", weight: 4, opacity: 0.9 }} />}
        <Me at={v.me} />
        {c && <FitBounds points={c.path.map((q) => [q.lat, q.lng])} padTL={[30, 130]} padBR={[30, 330]} fitKey={c.id} />}
        <Follow pos={v.me} />{/* 내 위치를 따라 지도 이동 */}
      </MapView>

      <div className="run-top">
        {v.pill && <span className="pill-dark">{v.pill}</span>}
        <span className={`pill-hex ${v.newCells ? "bump" : ""}`} key={v.newCells}>{t("hex_pill", { n: v.newCells })}</span>
      </div>
      {c && (
        <div className="progress-track" aria-label="course progress">
          <i style={{ width: `${v.progress * 100}%` }} />
          {ticks.map((tk) => <span key={tk.id} className={`tick ${v.visited.includes(tk.id) ? "done" : ""}`} style={{ left: `${tk.at * 100}%` }} />)}
        </div>
      )}
      {v.cue && <div className="cue">{v.cue}</div>}

      <div className="run-panel">
        <small>{t("distance")}</small>
        <div className="big">{(v.meters / 1000).toFixed(v.meters < 10000 ? 2 : 1)}<em>km</em></div>
        <div className="run-stats">
          <div><b>{fmtPace(v.seconds, v.meters)}</b><small>{t("pace")}</small></div>
          <div><b>{fmtTime(v.seconds)}</b><small>{t("time")}</small></div>
          <div><b>+{v.ascent}m</b><small>{t("ascent")}</small></div>
        </div>
        <p className="run-info">{c ? t("run_info") : t("run_info_free")}</p>
        {!c && <div className="free-shops">{v.freeShops.map(({ s, d }) => <ShopRow key={s.id} shop={s} dist={d} onCoupon={openCoupon} />)}</div>}
        <div className="run-btns">
          <button className="btn btn-ghost" onClick={app.run.togglePause}>{v.paused ? t("resume") : t("pause")}</button>
          <button className="btn btn-red" onClick={app.run.finish} data-testid="finish">{t("stop")}</button>
        </div>
      </div>
    </section>
  );
}

// 진행 막대 위에 스팟 위치(코스의 몇 % 지점인지) 표시
function useSpotTicks(course, spots) {
  return useMemo(() => {
    if (!course) return [];
    const cum = [0];
    for (let i = 1; i < course.path.length; i++) cum.push(cum[i - 1] + distance(course.path[i - 1], course.path[i]));
    return spots.map((s) => {
      let best = 0, bestD = Infinity;
      course.path.forEach((p, i) => { const d = distance(p, s); if (d < bestD) { bestD = d; best = i; } });
      return { id: s.id, at: Math.min(0.98, cum[best] / course.len) };
    });
  }, [course, spots]);
}
