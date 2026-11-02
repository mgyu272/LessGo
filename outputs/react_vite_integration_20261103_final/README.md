# Less GO 최종 앱 연동 경로 데이터

이 데이터셋은 `outputs/react_vite_integration_20261103_v3/`에서 복사한 별도 번들입니다. 기존 대표 경로 인덱스와 v2~v5 원본은 수정하지 않았습니다. 총 18개 앱 선택 슬롯과 실제 저장 ORS geometry/directions를 제공합니다. 정릉 5km 앱 시연 슬롯은 osm-v5-036/035 검토용 경로를 선택하지만 `review_required`, `formal_recommendation: false`, 고도 신뢰도 `low`를 유지합니다. 정식 정릉 5km 쌍은 `formal_routes`에 그대로 보존했습니다.

## 파일

- `routes.json`: 목적지·거리·Low/High 18개 앱 슬롯, 경고·지표·길안내. 정릉 5km는 `routes`가 검토용 시연 페어이며, 같은 객체의 `formal_routes`가 기존 정식 페어입니다.
- `routes.geojson`: 저장된 ORS 응답 geometry만 포함합니다. OSM 후보 좌표로 선을 만들지 않았습니다.
- `slots.csv`: 앱이 실제 선택하는 18개 슬롯 요약
- `formal_slots.csv`: 대체 전 정식 슬롯 요약
- `pair_comparison.csv`: 번들 audit가 산출한 앱 선택 Low/High 비교
- `app_pair_comparison.csv`: 9개 앱 선택 페어의 자세한 비교. 정릉 5km review pair의 도로 공유율 11.42% 포함
- `formal_pair_comparison.csv`: 정릉 5km 대체 전 정식 페어 비교
- `validation_audit.json`: geometry, directions, 슬롯·페어 검수
- `audit_report.md`, `diversification_report.md`: 검수 및 Low/High 비교 보고
- `build_dataset.py`, `audit_selection.py`: 로컬 저장 데이터만 읽어 번들을 재생성·검수하는 스크립트

## React/Vite에서 불러오기

번들의 `routes.json`과 `routes.geojson`을 앱의 `public/data/lessgo/`에 복사합니다.

```ts
type Mode = 'low' | 'high';
type Distance = '3km' | '5km' | '10km';
type Destination = 'simujang' | 'jeongneung' | 'uiryeong';

const [index, collection] = await Promise.all([
  fetch('/data/lessgo/routes.json').then(r => r.json()),
  fetch('/data/lessgo/routes.geojson').then(r => r.json()),
]);
function getRoute(destination: Destination, distance: Distance, mode: Mode) {
  return index.destinations[destination].distances[distance].routes[mode];
}
const route = getRoute('jeongneung', '5km', 'low');
const feature = collection.features.find((f: any) => f.id === route.feature_id);
const lineCoordinates = feature?.geometry.coordinates; // [longitude, latitude, elevation?]
const directions = route.directions;
```

목적지 3종 × 거리 3종 × 모드 2종으로 슬롯을 고릅니다. UI의 Low/High 필터는 `routes[mode]`의 `low` 또는 `high` 키를 사용합니다. 이전 API 소비자는 `high` 대신 `any`를 요청할 수 있으므로 서버 어댑터에서 `any -> high`로 변환하세요. 원래 인덱스 값은 `source_mode`에 기록됩니다.

## 검토 경고 표시

```tsx
{route.status === 'review_required' && (
  <Warning>검토 필요 · 정식 추천 아님</Warning>
)}
{route.elevation?.confidence === 'low' && (
  <Warning>고도 신뢰도 낮음 · 경사 지표는 추정값</Warning>
)}
```

`formal_recommendation`이 false면 정식 추천으로 배지/문구를 표시하지 마세요. `stairs_share`, 제한 정보, 반복 구간 등 `null`은 0이 아니라 원본에서 알 수 없다는 뜻입니다. 정릉 5km는 `routes.destinations.jeongneung.distances['5km'].routes`가 시연 선택 페어이고, `formal_routes`가 기존 정식 페어입니다. 두 검토 슬롯은 모두 `review_required`입니다.

## 길안내 구조

`route.directions`는 저장된 ORS instruction step 배열입니다. 각 항목은 `instruction`, `distance_m`, `duration_seconds`, `type`, `way_points: [startIndex, endIndex]`를 포함합니다. 지도상의 좌표를 만들 때는 `route.feature_id`로 GeoJSON feature를 조회하고 ORS가 반환한 LineString을 사용하세요. 저장된 directions가 없는 경로는 직선이나 추정 안내로 대체하지 마세요.

## 지도 표현과 급경사 표시

Low는 초록, High는 주황색의 단색 선으로 표시하고, 선택한 mode만 표시하거나 비교 화면에서 두 선을 함께 표시하세요. 급경사 마커/구간은 `route.elevation.steep_segments_8_percent`와 `steep_segments_10_percent`를 사용합니다. 이 데이터의 `start_m`/`distance_m`는 route chainage이므로 ORS 좌표 누적거리로 선형 보간해 지도 위치를 구하세요. `geometry`의 좌표를 직선 연결하거나 segment start를 배열 인덱스로 오해하지 마세요. 불확실 구간은 `route.elevation.uncertain_segments`를 별도 스타일/경고로 표현합니다. 데이터가 비어 있으면 마커를 만들지 않습니다.

## 재생성 및 검수

프로젝트 루트에서 실행합니다. 이 번들은 기존 ORS/OSM 캐시와 저장된 ORS 응답만 사용하며 API를 호출하지 않습니다.

```powershell
python outputs/react_vite_integration_20261103_final/finalize_bundle.py
```

`verified`는 원본 인덱스 상태이며 현장 안전 또는 출입구를 보증하지 않습니다. 새 경로 탐색, 추가 API 호출, 현장 검증은 이 번들 재생성 범위에 포함되지 않습니다.
