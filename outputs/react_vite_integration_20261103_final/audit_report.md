# Less GO 최종 앱 연동 번들 검수

- 앱 선택 슬롯: **18/18**, 누락 0
- 앱 선택 Low/High geometry 차이: **9/9 페어** (정릉 5km는 별도 검토용 페어)
- Low ≤ High 경사부담 및 8%·10% 비율: **9/9 페어 통과**
- 앱 선택 ORS geometry·directions: `validation_audit.json`의 slot integrity 참조
- 정릉 5km 검토 페어: `review_required`, `formal_recommendation=false`, elevation confidence `low`; `formal_routes`에는 이전 정식 페어 보존
- 정식 원본 18개 인덱스 및 v2~v5 결과는 변경하지 않았습니다.
- 번들 재생성 시 추가 ORS·Overpass 호출: **0회**

## 페어별 비교

자세한 9개 앱 페어 비교는 `app_pair_comparison.csv`를, 정릉 5km 교체 전 정식 페어는 `formal_pair_comparison.csv`를 참조하세요.

## 검토 필요

- 심우장 5km Low 반복 edge 400.9m 및 낮은 running score
- 심우장 10km Low 9.2093km로 목표보다 790.7m 짧음 (9~11km 확대 범위), High 계단 추정 약 133m
- 정릉 3km Low/High 공유 도로율 73.8%, 경사부담 차이 1.61점
- 정릉 5km 검토 페어의 고도 신뢰도 낮음; 출입구·고도·보행환경 현장 확인 필요

`verified`는 원본 인덱스 상태이지 현장 안전 보증이 아닙니다.
