// 공통 UI 부품 (디자인 원본: docs/design/*.dc.html)
// - useBottomSheet + BottomSheet : 끌어서 높이를 바꾸는 바텀시트 (멈추는 높이 여러 개, 손잡이 탭으로 전환, 키보드 ↑↓)
// - Chip, Segment, Badge          : 칩, 세그먼트 컨트롤, 작은 배지
// - ConfirmDialog, OptionSheet    : 확인 다이얼로그, 아래에서 올라오는 옵션 시트
// 색·그림자는 styles.css의 토큰(.glass / .soft / .card)을 따라요.

import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n.js";

// ---------- 바텀시트 ----------
// snaps: 시트가 멈추는 높이(px), 작은 것부터. 화면 높이에 맞춰 바꾸고 싶으면 함수로 넘겨요 (screenH => [...])
export function useBottomSheet({ snaps: snapsIn, initial = 1, screenSelector = ".phone" }) {
  const [snaps] = useState(() => {
    const h = document.querySelector(screenSelector)?.offsetHeight || window.innerHeight;
    return typeof snapsIn === "function" ? snapsIn(h) : snapsIn;
  });
  const [height, setHeight] = useState(snaps[Math.min(initial, snaps.length - 1)]);
  const [dragging, setDragging] = useState(false);
  const drag = useRef(null);
  const justDragged = useRef(false); // 끌기를 마친 직후의 click은 무시해요
  const nearest = (h) => snaps.reduce((best, s) => (Math.abs(s - h) < Math.abs(best - h) ? s : best), snaps[0]);
  const index = snaps.indexOf(nearest(height));
  const max = snaps[snaps.length - 1];

  const handlers = {
    onPointerDown: (e) => {
      drag.current = { y: e.clientY, h: height, moved: false };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
      setDragging(true);
    },
    onPointerMove: (e) => {
      const d = drag.current; if (!d) return;
      // PC 아이폰 프레임은 축소돼 보여서, 화면상 이동량을 원래 크기로 되돌려요
      const el = document.querySelector(screenSelector);
      const scale = el ? el.getBoundingClientRect().height / el.offsetHeight || 1 : 1;
      const dy = (d.y - e.clientY) / scale;
      if (Math.abs(dy) > 5) d.moved = true;
      setHeight(Math.max(snaps[0] - 30, Math.min(max + 30, d.h + dy)));
    },
    onPointerUp: () => {
      const d = drag.current; drag.current = null; setDragging(false);
      if (!d) return;
      justDragged.current = d.moved;
      setHeight((h) => (d.moved ? nearest(h) : d.h));
    },
    // 키보드: ↑ 한 단계 올리기, ↓ 한 단계 내리기
    onKeyDown: (e) => {
      if (e.key === "ArrowUp") { e.preventDefault(); setHeight(snaps[Math.min(snaps.length - 1, index + 1)]); }
      if (e.key === "ArrowDown") { e.preventDefault(); setHeight(snaps[Math.max(0, index - 1)]); }
    },
  };
  handlers.onPointerCancel = handlers.onPointerUp;
  // 손잡이를 탭하면: 맨 위면 가운데로, 아니면 맨 위로 (디자인 원본 동작)
  const toggle = () => {
    if (justDragged.current) { justDragged.current = false; return; }
    setHeight(index === snaps.length - 1 ? snaps[Math.max(0, snaps.length - 2)] : max);
  };
  const setIndex = (i) => setHeight(snaps[Math.max(0, Math.min(snaps.length - 1, i))]);
  return { snaps, height, index, dragging, handlers, toggle, setIndex, expanded: index === snaps.length - 1 };
}

export function BottomSheet({ sheet, className = "", label, children, ...rest }) {
  return (
    <section className={`bsheet hanji-sheet ${sheet.dragging ? "dragging" : ""} ${className}`} style={{ height: sheet.height }} {...rest}>
      <button className="bsheet-handle" {...sheet.handlers} onClick={sheet.toggle}
        aria-label={label || t(sheet.expanded ? "sheet_down" : "sheet_up")} aria-expanded={sheet.expanded}>
        <span className="grip" />
      </button>
      {children}
    </section>
  );
}

// ---------- 칩 ----------
export function Chip({ on = false, icon, children, className = "", caret = false, ...rest }) {
  return (
    <button type="button" className={`ui-chip ${on ? "on" : "glass"} ${className}`} aria-pressed={caret ? undefined : on} {...rest}>
      {icon}{children}
      {caret && <svg className="caret" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>}
    </button>
  );
}

// ---------- 세그먼트 ----------
// options: [{ value, label, sub }]
export function Segment({ options, value, onChange, label, className = "" }) {
  return (
    <div className={`ui-segment ${className}`} role="radiogroup" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          <span className="seg-main">{o.label}</span>
          {o.sub && <small>{o.sub}</small>}
        </button>
      ))}
    </div>
  );
}

// ---------- 배지 ----------
// tone: green(기본) · warn(검토·경고) · orange(고도 추정값 등) · plain
export function Badge({ tone = "green", children, className = "" }) {
  return <span className={`ui-badge ${tone} ${className}`}>{children}</span>;
}

// ---------- 켜고 끄는 줄 (제목 + 설명 + 스위치) ----------
export function Toggle({ checked, onChange, title, sub, className = "" }) {
  return (
    <label className={`toggle-row ${className}`}>
      <span><b>{title}</b><small>{sub}</small></span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><i className="switch" />
    </label>
  );
}

// ---------- 확인 다이얼로그 ----------
export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, onConfirm, onCancel }) {
  const okRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    okRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onCancel?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="ui-layer">
      <div className="ui-scrim" onClick={onCancel} />
      <div className="ui-dialog hanji-sheet" role="alertdialog" aria-modal="true" aria-labelledby="ui-dialog-title">
        <h2 id="ui-dialog-title">{title}</h2>
        {body && <p>{body}</p>}
        <div className="ui-dialog-row">
          <button type="button" className="btn btn-soft" onClick={onCancel}>{cancelLabel || t("cancel")}</button>
          <button type="button" ref={okRef} className="btn btn-cta" onClick={onConfirm}>{confirmLabel || t("ok")}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- 옵션 시트 ----------
// options: [{ value, label, sub }], multi면 values(Set) / 아니면 value 하나
export function OptionSheet({ open, title, options, value, values, multi = false, cols = 2, onPick, onClose, applyLabel }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="ui-layer">
      <div className="ui-scrim" onClick={onClose} />
      <section className="ui-optsheet hanji-sheet rise" role="dialog" aria-modal="true" aria-label={title}>
        <span className="grip" aria-hidden="true" />
        <h2>{title}</h2>
        <div className="ui-opts" role={multi ? "group" : "radiogroup"} aria-label={title} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {options.map((o) => {
            const on = multi ? values?.has(o.value) : value === o.value;
            return (
              <button key={o.value} type="button" role={multi ? "checkbox" : "radio"} aria-checked={on}
                className={`ui-opt ${on ? (multi ? "on multi" : "on") : "soft"}`} onClick={() => onPick(o.value)}>
                <b>{o.label}</b>{o.sub && <small>{o.sub}</small>}
              </button>
            );
          })}
        </div>
        <button type="button" className="btn btn-cta" onClick={onClose}>{applyLabel || t("apply")}</button>
      </section>
    </div>
  );
}
