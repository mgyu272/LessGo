// 별 → 쿠폰 공통 부품 (완주 화면 · 내 기록 · 도장·쿠폰 화면)
// 별 10개마다 쿠폰 1장. 지금 쿠폰은 모두 "제휴 협의 중"이라 혜택·사용 기한은 자리표시이고, 실제 사용(QR)은 막혀 있어요.

import { useApp } from "../state/AppContext.jsx";
import { t } from "../lib/i18n.js";
import { STAR_RULES } from "../state/useUserData.js";
import { Badge } from "./ui.jsx";

// 쿠폰까지 진행 바 (금색): 보유 별 / 10
export function StarProgress({ balance, compact = false }) {
  const per = STAR_RULES.perCoupon;
  const hold = balance % per;
  return (
    <div className={`star-prog ${compact ? "compact" : ""}`}>
      <div className="sp-row"><b>{t("stars_to_coupon", { n: per - hold })}</b><small>{hold}/{per}</small></div>
      <span className="gold-bar" role="progressbar" aria-valuemin={0} aria-valuemax={per} aria-valuenow={hold} aria-label={t("to_coupon")}><i style={{ width: `${(hold / per) * 100}%` }} /></span>
    </div>
  );
}

// 받은 쿠폰 한 장: 가게 이름 · [혜택], [사용 기한], 제휴 협의 중 배지, 비활성 사용 버튼
export function CouponItem({ coupon }) {
  const { data } = useApp();
  const shop = data.shops.find((s) => s.id === coupon.shopId);
  const name = shop?.name?.ko || t("shop_tbd"); // 가게 이름은 지금 한국어만 있어요
  return (
    <div className="coupon-item">
      <div className="ci-text">
        <span className="ci-top"><b>{name}</b>{coupon.pending && <Badge tone="orange">{t("partner_pending")}</Badge>}</span>
        <small>{t("benefit_tbd")} · {t("expiry_tbd")}</small>
      </div>
      <button className="btn btn-soft ci-use" disabled aria-describedby={`ci-${coupon.id}`}>{t("use_coupon")}</button>
      <small className="ci-note" id={`ci-${coupon.id}`}>{t("usable_after_partner")}</small>
    </div>
  );
}
