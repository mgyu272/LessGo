// 도장·쿠폰(스탬프·별 + 내 영역 + 랭킹) · 기록 목록(로그아웃)  — 새 "내 기록" 화면(Stats.jsx)에서 열려요

import { useEffect, useState } from "react";
import { useApp } from "../state/AppContext.jsx";
import { t, loc } from "../lib/i18n.js";
import { fmtTime, fmtPace } from "../lib/geo.js";
import { boundary, areaKm2 } from "../lib/territory.js";
import { NEXT_REWARD, STAR_RULES } from "../state/useUserData.js";
import { MapView, FitBounds, HexLayer, Route } from "../components/MapView.jsx";
import { Seal, sealText } from "../components/Bits.jsx";

// ---------------- 완주 요약 ----------------
// ---------------- ⑨ 스탬프·별 + 내 영역 + 랭킹 ----------------
const REWARDS = {
  ko: [["제휴 가게 무료 음료·빵", "달리고 나서 쉬어가기", 150], ["러닝 용품 할인권", "양말·벨트 등 제휴 상품", 300], ["동네 길 가꾸기에 기부", "가로등·안내판 개선에 쓰여요", 100], ["성북 러닝 행사 참가권", "동네 러닝 모임·소규모 대회", 500]],
  en: [["Free drink or bread at a partner", "Take a break after your run", 150], ["Running gear voucher", "Socks, belts and other partner items", 300], ["Donate to neighborhood paths", "Goes to street lights and signs", 100], ["Seongbuk running event pass", "Local run club or small race", 500]],
};

export function Stars() {
  const app = useApp();
  const { user, data } = app;
  const total = user.totalStars;
  const cells = user.cells;
  const landmarkOwned = [...data.landmarkCells].filter((c) => cells.has(c)).length;
  const pts = [...cells, ...data.landmarkCells].flatMap((c) => boundary(c));
  const [board, setBoard] = useState(undefined);
  useEffect(() => { user.leaderboard().then(setBoard); }, [user.leaderboard, cells.size]);

  return (
    <section className="screen stars-screen">
      <div className="stars-head">
        <small>{t("my_stars")}</small>
        <div className="star-total serif"><span>★</span> <b>{total}</b></div>
        <small>{t("stars_from")}</small>
      </div>
      <div className="scroll-y pad stars-body">
        <div className="next-card">
          <div className="row-between"><b>{t("next_reward", { n: NEXT_REWARD - (total % NEXT_REWARD) })}</b><small>{NEXT_REWARD}</small></div>
          <div className="progress"><i style={{ width: ((total % NEXT_REWARD) / NEXT_REWARD) * 100 + "%" }} /></div>
        </div>

        <h4>{t("my_seals")} {user.stamps.size}/{data.spots.length}</h4>
        <div className="seal-grid">
          {data.spots.map((sp) => (
            <figure key={sp.id}><Seal text={sealText(sp)} size={52} off={!user.stamps.has(sp.id)} /><figcaption>{loc(sp.name)}</figcaption></figure>
          ))}
        </div>

        <h4>{t("my_territory")}</h4>
        <MapView className="map-mini">
          <HexLayer cells={cells} landmarkCells={data.landmarkCells} goals />
          <FitBounds points={pts} fitKey={"t" + cells.size} />
        </MapView>
        <div className="terr-stats">
          <div><b>{cells.size}</b><small>{t("cells")}</small></div>
          <div><b>{landmarkOwned}/{data.landmarkCells.size}</b><small>{t("landmark_cells")}</small></div>
          <div><b>{areaKm2(cells).toFixed(2)}</b><small>{t("area")} km²</small></div>
        </div>

        <h4>{t("ranking")}</h4>
        {board === null || !user.online ? <p className="note mint">{t("rank_local")}</p> : (
          <div className="rank-list">
            {(board || []).map((b, i) => (
              <div key={i} className={`rank ${b.is_me ? "me" : ""}`}>
                <span className="no">{i + 1}</span><b>{b.nickname}{b.is_me ? ` (${t("rank_me")})` : ""}</b><span>⬢ {b.cells}</span>
              </div>
            ))}
          </div>
        )}

        <h4>{t("how_earn")}</h4>
        <div className="earn-grid">
          <div><b>+{STAR_RULES.perKm}</b>{t("e_km")}</div>
          <div><b>+{STAR_RULES.perStamp}</b>{t("e_stamp")}</div>
          <div><b>+2~3</b>{t("e_buy")}</div>
        </div>
        <h4>{t("exchange")}</h4>
        {REWARDS[app.lang].map(([a, b, c]) => (
          <div className="reward" key={a}><div><b>{a}</b><small>{b}</small></div><span className="cost">★ {c}</span></div>
        ))}
        <p className="foot">{t("reward_foot")}</p>
      </div>
    </section>
  );
}

// ---------------- 내 기록 ----------------
export function Records() {
  const app = useApp();
  const { user } = app;
  return (
    <section className="screen light">
      <header className="topbar">
        <div><h3>{t("tab_records")}</h3><small>{t("hello", { name: user.profile?.nickname || "" })}</small></div>
        <button className="link" onClick={async () => { await user.signOut(); app.go("onboarding"); }}>{t("logout")}</button>
      </header>
      <div className="scroll-y pad has-tabbar">
        {user.runs.length === 0 && <p className="empty">{t("no_records")}</p>}
        {user.runs.map((r) => (
          <div className="record" key={r.id}>
            <div className="date"><b>{new Date(r.date).getDate()}</b><small>{new Date(r.date).toLocaleDateString(app.lang === "ko" ? "ko-KR" : "en-US", { month: "short" })}</small></div>
            <div className="body">
              <b>{loc(r.name)}</b>
              <div className="meta"><span>{(r.meters / 1000).toFixed(2)}km</span><span>{fmtTime(r.seconds)}</span><span>{fmtPace(r.seconds, r.meters)}</span><span>⬢ {r.cells}</span><span>📍 {r.stamps}</span></div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
