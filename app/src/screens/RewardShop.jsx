import { useApp } from "../state/AppContext.jsx";
import { loc } from "../lib/i18n.js";
import { shopsNear, shopKind } from "../components/NearbyShops.jsx";

// Nearby stores only. QR scanning and coupon issuance are intentionally disabled.
export function RewardShop() {
  const app = useApp();
  const near = shopsNear(app.spot, app.data.shops).slice(0, 4);
  return <section className="reward-content">
    <h3>주변 가게</h3>
    <p className="muted">역사지 주변 가게를 둘러보세요.</p>
    {near.length ? near.map(({ s, d }) =>
      <a className="reward-store" key={s.id} href={s.kakao_url} target="_blank" rel="noopener noreferrer">
        <span>{shopKind(s.category) === "cafe" ? "☕" : "🍴"}</span>
        <span><b>{loc(s.name)}</b><small>약 {d}m · 카카오맵에서 보기</small></span>
        <span>↗</span>
      </a>
    ) : <p className="muted">등록된 주변 가게가 없습니다.</p>}
    <p className="muted">가게 정보는 참고용이며, 실제 제휴 및 할인 혜택은 제공되지 않습니다.</p>
  </section>;
}
