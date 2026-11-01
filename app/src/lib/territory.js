// 육각형 영역 채우기 (H3)
// 달린 위치를 육각형 칸 번호(H3 cell)로 바꿔요. "내가 가진 칸" 목록은 state/useUserData.js가 저장해요.
//
// 해상도(RES)별 육각형 한 변 길이: 9 ≈ 174m, 10 ≈ 66m, 11 ≈ 25m
// 골목을 달려도 칸이 잘 채워지도록 10을 기본으로 했어요.

import { latLngToCell, gridDistance, gridPathCells, cellToBoundary, cellArea } from "h3-js";

export const RES = 10;

export function cellOf(p) { return latLngToCell(p.lat, p.lng, RES); }

// 직전 칸에서 지금 칸까지 지나간 칸들 (GPS가 몇 초 끊겨 칸을 건너뛰어도 이어서 채워요)
export function cellsBetween(lastCell, p) {
  const cell = cellOf(p);
  if (!lastCell || lastCell === cell) return { cell, path: [cell] };
  try {
    if (gridDistance(lastCell, cell) <= 6) return { cell, path: gridPathCells(lastCell, cell) };
  } catch { /* 너무 멀거나 계산이 안 되면 지금 칸만 */ }
  return { cell, path: [cell] };
}

// 칸의 꼭짓점 [[lat,lng], ...] (지도 다각형용)
export function boundary(cell) { return cellToBoundary(cell); }

// 칸 면적 합계(km²)
export function areaKm2(cells) {
  let s = 0;
  for (const c of cells) s += cellArea(c, "km2");
  return s;
}
