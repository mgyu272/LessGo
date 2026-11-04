// 장소와 이야기 화면에서 쓰는 장소 주제(태그). spots.json에는 아직 주제가 없어서 여기 한곳에 둬요.
// 장소를 추가하면 여기에 id와 주제를 넣어 주세요. (i18n.js의 topic_* 문구와 짝)

export const TOPICS = ["all", "tomb", "indep", "hanok", "wall"];

export const PLACE_TOPICS = {
  simujang: ["indep", "hanok"],
  jeongneung: ["tomb"],
  uiryeong: ["tomb"],
};

// 정보가 달라요 신고 이유 (Firestore reports.reason 값과 같아요. 보안 규칙에도 같은 목록이 있어요)
export const REPORT_REASONS = ["hours", "fee", "entrance", "closed", "story", "etc"];

// 카카오맵 길찾기 링크 (목적지만 정해 두면 출발지는 카카오맵이 현재 위치로 잡아요)
export const kakaoDirections = (name, lat, lng) => `https://map.kakao.com/link/to/${encodeURIComponent(name)},${lat},${lng}`;
