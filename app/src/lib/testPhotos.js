// AI 역사 렌즈 테스트 사진 (현장에 못 가는 사람도 써볼 수 있게)
// 사진 파일은 public/test-photos/ 에 있어요. spotId는 routes.js DESTINATIONS와 같은 장소 id
export const TEST_PHOTOS = [
  { id: "simujang", spotId: "simujang", src: "/simujang-small.jpg", name: { ko: "심우장", en: "Simujang" } },
  { id: "jeongneung", spotId: "jeongneung", src: "/jeongneung-small.jpg", name: { ko: "정릉", en: "Jeongneung" } },
  { id: "uireung", spotId: "uiryeong", src: "/uireung-small.jpg", name: { ko: "의릉", en: "Uireung" } },
];

export const testPhotoById = (id) => TEST_PHOTOS.find((p) => p.id === id) || null;

// 테스트 사진을 카메라·갤러리로 고른 사진과 같은 File로 바꿔요
export async function loadTestPhotoFile(photo) {
  const res = await fetch(photo.src);
  if (!res.ok) throw new Error("test_photo_missing");
  const blob = await res.blob();
  return new File([blob], `${photo.id}.jpg`, { type: blob.type || "image/jpeg", lastModified: Date.now() });
}

// 카메라를 쓸 수 없는 환경인지 (데스크톱이거나, 카메라가 없거나, 카메라 권한을 막아 둔 경우)
export async function cameraUnavailable() {
  try {
    const desktop = !window.matchMedia?.("(pointer: coarse)").matches;
    if (desktop) return true;
    const perm = await navigator.permissions?.query({ name: "camera" }).catch(() => null);
    if (perm?.state === "denied") return true;
    const devices = await navigator.mediaDevices?.enumerateDevices?.();
    if (devices && !devices.some((d) => d.kind === "videoinput")) return true;
    return false;
  } catch {
    return false;
  }
}
