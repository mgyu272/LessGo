import { useEffect, useRef, useState } from "react";
import { t } from "../lib/i18n.js";
import { useApp } from "../state/AppContext.jsx";
import { analyzeImage, generateImageExplanation, localizeImageAnalysis } from "../lib/ai.js";
import * as voice from "../lib/voice.js";

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const MAX_PROCESSED_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1800;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXTENSION_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function getImageType(file) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (/image\/(heic|heif)/i.test(file.type) || ["heic", "heif"].includes(extension)) return "unsupported_heic";
  const extensionType = EXTENSION_TYPES[extension];
  if (SUPPORTED_TYPES.has(file.type)) return file.type;
  if (extensionType) return extensionType;
  return "unsupported_type";
}

function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file, { imageOrientation: "from-image" }).then((bitmap) => ({
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    })).catch(() => decodeImageElement(file));
  }
  return decodeImageElement(file);
}

function decodeImageElement(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image_decode_failed"));
    };
    image.src = url;
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("image_encode_failed"));
    }, type, quality);
  });
}

function evidenceStatusKey(evidence = {}) {
  if (evidence.evidenceStatus === "conflicting") return "history_lens_evidence_conflicting";
  if (evidence.evidenceStatus === "supported" && evidence.sourceLevel === "official") return "history_lens_evidence_official";
  if (evidence.evidenceStatus === "supported" && evidence.sourceLevel === "internal") return "history_lens_evidence_internal";
  return "history_lens_evidence_insufficient";
}

function referenceComparisonKey(comparison = {}) {
  if (comparison.status === "matched") return "history_lens_reference_matched";
  if (comparison.status === "mismatched") return "history_lens_reference_mismatched";
  if (comparison.status === "inconclusive") return "history_lens_reference_inconclusive";
  return "history_lens_reference_not_compared";
}

function visitorStatusKey(analysis) {
  if (analysis?.evidence?.evidenceStatus === "conflicting") return "history_lens_visitor_conflict";
  if (analysis?.identificationStatus === "unknown" || !analysis?.candidateName?.trim()) return "history_lens_visitor_unknown";
  if (analysis?.identificationStatus === "uncertain") return "history_lens_visitor_uncertain";
  if (analysis?.evidence?.evidenceStatus === "supported" && analysis.evidence.sourceLevel === "official") return "history_lens_visitor_official";
  if (analysis?.evidence?.evidenceStatus === "supported" && analysis.evidence.sourceLevel === "internal") return "history_lens_visitor_internal";
  return "history_lens_visitor_insufficient";
}

function visualFeatureSummary(features, lang) {
  const visible = (Array.isArray(features) ? features : []).filter((item) => typeof item === "string" && item.trim()).slice(0, 3);
  if (!visible.length) return t("history_lens_no_visual_features");
  const list = lang === "en"
    ? visible.length < 2 ? visible[0] : `${visible.slice(0, -1).join(", ")}, and ${visible.at(-1)}`
    : visible.join(", ");
  return t("history_lens_visual_summary", { features: list });
}

function isOfficialGrounded(analysis) {
  return analysis?.explanation?.type === "grounded" && analysis?.evidence?.sourceLevel === "official" && analysis?.evidence?.evidenceStatus === "supported";
}

async function resizeAndCompress(file, type) {
  const image = await decodeImage(file);
  try {
    if (!image.width || !image.height) throw new Error("image_decode_failed");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("image_encode_failed");

    // Canvas decoding applies the image's EXIF orientation before drawing.
    const outputType = type === "image/png" ? "image/webp" : type;
    const qualities = [0.84, 0.76, 0.68, 0.6, 0.52, 0.46];
    let maxSide = MAX_IMAGE_SIDE;
    let result = null;

    for (const quality of qualities) {
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
      result = await canvasBlob(canvas, outputType, quality);
      if (result.size <= MAX_PROCESSED_BYTES) break;
      maxSide = Math.max(640, Math.floor(maxSide * 0.8));
    }

    if (!result || result.size > MAX_PROCESSED_BYTES) throw new Error("image_compress_failed");
    const actualType = result.type || outputType;
    const extension = actualType === "image/png" ? "png" : actualType === "image/jpeg" ? "jpg" : "webp";
    const baseName = file.name.replace(/\.[^.]+$/, "") || "history-lens-photo";
    return new File([result], `${baseName}.${extension}`, { type: actualType, lastModified: Date.now() });
  } finally {
    image.close();
  }
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("image_read_failed"));
      else resolve(value.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("image_read_failed"));
    reader.readAsDataURL(file);
  });
}

export default function HistoryLens({ spotId, spotName }) {
  const app = useApp();
  const lang = app.lang === "ko" ? "ko" : "en";
  const cameraInput = useRef(null);
  const galleryInput = useRef(null);
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisLang, setAnalysisLang] = useState(null);
  const [localizing, setLocalizing] = useState(false);
  const [localizationError, setLocalizationError] = useState("");
  const [speechStatus, setSpeechStatus] = useState("idle");
  const analysisController = useRef(null);
  const localizationController = useRef(null);
  const speechHandle = useRef(null);
  const analysisRef = useRef(null);
  const langRef = useRef(lang);
  const previousLang = useRef(lang);
  analysisRef.current = analysis;
  langRef.current = lang;

  const stopNarration = () => {
    speechHandle.current?.stop();
    speechHandle.current = null;
    setSpeechStatus("idle");
  };

  const localizeExistingResult = async (savedAnalysis, targetLang) => {
    if (!savedAnalysis) return;
    localizationController.current?.abort();
    const controller = new AbortController();
    localizationController.current = controller;
    setLocalizing(true);
    setLocalizationError("");
    setAnalysisLang(null); // Never show or read stale-language results while re-localizing.
    try {
      const localized = await localizeImageAnalysis({
        spotId,
        lang: targetLang,
        testData: savedAnalysis.testData === true,
        referenceComparison: savedAnalysis.referenceComparison,
        vision: {
          candidateName: savedAnalysis.candidateName,
          objectType: savedAnalysis.objectType,
          subjectLevel: savedAnalysis.subjectLevel,
          visualFeatures: savedAnalysis.visualFeatures,
          identificationStatus: savedAnalysis.identificationStatus,
          reason: savedAnalysis.reason,
        },
      }, { signal: controller.signal });
      if (controller.signal.aborted || langRef.current !== targetLang) return;
      setAnalysis(localized);
      setAnalysisLang(targetLang);
    } catch (error) {
      if (controller.signal.aborted) return;
      setLocalizationError(error.code === "gemini_not_configured" ? t("history_lens_language_not_ready") : t("history_lens_language_failed"));
    } finally {
      if (!controller.signal.aborted) setLocalizing(false);
    }
  };

  const playNarration = (restart = false) => {
    if (!analysis?.explanation?.text || analysisLang !== lang || localizing || !voice.speechSupported()) return;
    if (!restart && speechStatus === "paused" && speechHandle.current) {
      speechHandle.current.resume();
      setSpeechStatus("speaking");
      return;
    }
    stopNarration();
    const handle = voice.speakManaged(analysis.explanation.text, {
      lang,
      onstart: () => setSpeechStatus("speaking"),
      onpause: () => setSpeechStatus("paused"),
      onresume: () => setSpeechStatus("speaking"),
      onend: () => { speechHandle.current = null; setSpeechStatus("idle"); },
      onerror: () => { speechHandle.current = null; setSpeechStatus("idle"); setNotice(t("history_lens_voice_failed")); },
    });
    speechHandle.current = handle;
    if (handle) setSpeechStatus("speaking");
  };

  const pauseNarration = () => {
    if (speechStatus === "speaking") {
      speechHandle.current?.pause();
      setSpeechStatus("paused");
    } else if (speechStatus === "paused") {
      speechHandle.current?.resume();
      setSpeechStatus("speaking");
    }
  };

  useEffect(() => {
    if (!photo?.previewUrl) return undefined;
    return () => URL.revokeObjectURL(photo.previewUrl);
  }, [photo?.previewUrl]);

  useEffect(() => () => {
    analysisController.current?.abort();
    localizationController.current?.abort();
    speechHandle.current?.stop();
  }, []);

  useEffect(() => {
    if (previousLang.current === lang) return;
    previousLang.current = lang;
    stopNarration();
    const savedAnalysis = analysisRef.current;
    if (savedAnalysis) void localizeExistingResult(savedAnalysis, lang);
  }, [lang]);

  useEffect(() => {
    stopNarration();
    analysisController.current?.abort();
    localizationController.current?.abort();
    setPhoto(null);
    setAnalysis(null);
    setAnalysisLang(null);
    setAnalysisError("");
    setLocalizing(false);
    setLocalizationError("");
  }, [spotId]);

  const choosePhoto = async (event) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    stopNarration();
    analysisController.current?.abort();
    localizationController.current?.abort();
    setAnalyzing(false);
    setAnalysis(null);
    setAnalysisLang(null);
    setLocalizing(false);
    setLocalizationError("");
    setAnalysisError("");
    setNotice("");
    if (!file) return;

    const imageType = getImageType(file);
    if (imageType === "unsupported_heic") {
      setNotice(t("history_lens_heic_unsupported"));
      return;
    }
    if (!SUPPORTED_TYPES.has(imageType)) {
      setNotice(t("history_lens_type_unsupported"));
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setNotice(t("history_lens_too_large"));
      return;
    }

    setBusy(true);
    try {
      const processedFile = await resizeAndCompress(file, imageType);
      const previewUrl = URL.createObjectURL(processedFile);
      setPhoto({
        file: processedFile,
        previewUrl,
        originalSize: file.size,
      });
    } catch {
      setNotice(t("history_lens_process_failed"));
    } finally {
      setBusy(false);
    }
  };

  const removePhoto = () => {
    stopNarration();
    analysisController.current?.abort();
    localizationController.current?.abort();
    setAnalyzing(false);
    setPhoto(null);
    setAnalysis(null);
    setAnalysisLang(null);
    setLocalizing(false);
    setLocalizationError("");
    setAnalysisError("");
    setNotice("");
  };

  const runAnalysis = async () => {
    if (!photo || analyzing) return;
    stopNarration();
    localizationController.current?.abort();
    setLocalizing(false);
    setLocalizationError("");
    analysisController.current?.abort();
    const controller = new AbortController();
    analysisController.current = controller;
    setAnalyzing(true);
    setAnalysis(null);
    setAnalysisLang(null);
    setAnalysisError("");
    setNotice("");
    try {
      const imageBase64 = await fileToBase64(photo.file);
      const requestLang = langRef.current;
      const result = await analyzeImage({
        spotId,
        spotName,
        lang: requestLang,
        mimeType: photo.file.type,
        imageBase64,
      }, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setAnalysis(result);
        if (langRef.current === requestLang) {
          setAnalysisLang(requestLang);
          if (result.explanationPending) {
            try {
              const explanationResult = await generateImageExplanation({
                spotId,
                lang: requestLang,
                testData: result.testData === true,
                vision: {
                  candidateName: result.candidateName,
                  objectType: result.objectType,
                  subjectLevel: result.subjectLevel,
                  visualFeatures: result.visualFeatures,
                  identificationStatus: result.identificationStatus,
                  reason: result.reason,
                },
              }, { signal: controller.signal });
              if (!controller.signal.aborted && langRef.current === requestLang) {
                setAnalysis((current) => current ? { ...current, ...explanationResult, explanationPending: false } : current);
              }
            } catch (error) {
              if (!controller.signal.aborted && langRef.current === requestLang) {
                setAnalysis((current) => current ? {
                  ...current,
                  explanationPending: false,
                  explanationError: { code: error.code || "explanation_failed", message: error.message || t("history_lens_explanation_error") },
                } : current);
              }
            }
          }
        }
        else void localizeExistingResult(result, langRef.current);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const messageKey = error.code === "gemini_not_configured" ? "history_lens_not_ready" :
        error.code === "gemini_rate_limited" ? "history_lens_rate_limited" :
        error.code === "gemini_timeout" ? "history_lens_timeout" :
        error.code === "gemini_dns_error" ? "history_lens_dns_error" :
        error.code === "gemini_network_error" ? "history_lens_network_error" :
        error.code === "gemini_service_unavailable" ? "history_lens_service_unavailable" :
        error.code === "gemini_auth_error" ? "history_lens_auth_error" :
        error.code === "client_request_timeout" ? "history_lens_client_timeout" :
        error.code === "local_api_network_error" ? "history_lens_local_api_error" :
        error.code === "unsupported_image_model" ? "history_lens_model_unavailable" : "history_lens_analysis_failed";
      setAnalysisError(t(messageKey));
    } finally {
      if (!controller.signal.aborted) setAnalyzing(false);
    }
  };

  return (
    <div className="rise pd-col history-lens-page" style={{maxWidth: 720, margin: "0 auto", paddingBottom: 28}}>
      <article className="card history-lens-card" style={{padding: 22, borderRadius: 22}}>
        <div className="history-lens-art" aria-hidden="true">
          <span className="history-lens-art-orbit" />
          <svg viewBox="0 0 120 100" role="presentation">
            <path d="M20 48 60 20l40 28v36H20z" />
            <path d="m13 49 47-34 47 34M43 84V57h34v27M55 58v26M67 58v26" />
            <path d="M18 42h8v-9M102 42h-8v-9M18 61v9h8M102 61v9h-8" />
          </svg>
          <span className="history-lens-art-spark">✦</span>
        </div>
        <div className="history-lens-intro-copy">
          <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"7px 12px",borderRadius:999,background:"rgba(65,148,107,.10)",fontWeight:700,fontSize:13,marginBottom:10}}>📍 {spotName}</div>
          <span className="history-lens-eyebrow"><span aria-hidden="true">✦</span> {t("history_lens_badge")}</span>
          <h2>{t("history_lens_intro")}</h2>
          <p>{t("history_lens_intro_detail")}</p>
        </div>
        <div className="history-lens-flow" aria-label={t("history_lens_flow_label")}>
          {["history_lens_flow_photo", "history_lens_flow_analyze", "history_lens_flow_result"].map((key, index) => (
            <div className="history-lens-flow-step" key={key}>
              <span className="history-lens-flow-number">0{index + 1}</span>
              <span>{t(key)}</span>
            </div>
          ))}
        </div>
      </article>

      <input
        ref={cameraInput}
        className="history-lens-file-input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={choosePhoto}
        aria-label={t("history_lens_camera")}
      />
      <input
        ref={galleryInput}
        className="history-lens-file-input"
        type="file"
        accept="image/*"
        onChange={choosePhoto}
        aria-label={t("history_lens_gallery")}
      />

      <div className="history-lens-actions history-lens-pick-actions">
        <button type="button" className="btn btn-cta history-lens-camera-button" onClick={() => cameraInput.current?.click()} disabled={busy}>
          <span className="history-lens-button-icon" aria-hidden="true">◎</span>{t("history_lens_camera")}
        </button>
        <button type="button" className="btn btn-soft history-lens-gallery-button" onClick={() => galleryInput.current?.click()} disabled={busy}>
          <span className="history-lens-button-icon" aria-hidden="true">▧</span>{t("history_lens_gallery")}
        </button>
      </div>

      {busy && <p className="note mint" role="status">{t("history_lens_processing")}</p>}
      {notice && <p className="note cream" role="status">{notice}</p>}
      {localizing && <p className="note mint" role="status">{t("history_lens_language_updating")}</p>}
      {localizationError && <div className="note cream" role="alert"><p>{localizationError}</p><button type="button" className="btn btn-soft" onClick={() => localizeExistingResult(analysisRef.current, lang)}>{t("history_lens_retry")}</button></div>}

      {!photo && !busy && (
        <p className="history-lens-empty-hint"><span aria-hidden="true">◎</span> {t("history_lens_select_hint")}</p>
      )}

      {photo && (
        <section className="history-lens-preview card" style={{borderRadius:22,overflow:"hidden",padding:16}} aria-label={t("history_lens_preview_title")}>
          <img className="history-lens-image" style={{width:"100%",maxHeight:380,objectFit:"cover",borderRadius:16}} src={photo.previewUrl} alt={t("history_lens_preview_alt")} />
          <p className="history-lens-size">
            {t("history_lens_file_size", {
              original: formatBytes(photo.originalSize),
              processed: formatBytes(photo.file.size),
            })}
          </p>
          <div className="history-lens-actions" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,margin:"10px 0 12px"}}>
            <button type="button" className="btn btn-soft" style={{minHeight:42,padding:"9px 12px",fontSize:14,borderRadius:12,boxShadow:"none"}} onClick={() => galleryInput.current?.click()} disabled={busy}>
              {t("history_lens_change")}
            </button>
            <button type="button" className="btn btn-soft" style={{minHeight:42,padding:"9px 12px",fontSize:14,borderRadius:12,boxShadow:"none"}} onClick={removePhoto} disabled={busy}>
              {t("history_lens_delete")}
            </button>
          </div>
          <button
            type="button"
            className="btn btn-cta history-lens-analyze"
            style={{minHeight:48,borderRadius:13,boxShadow:"none",fontSize:15,fontWeight:700}}
            onClick={runAnalysis}
            disabled={analyzing}
          >
            {t(analyzing ? "history_lens_analyzing" : "history_lens_analyze")}
          </button>
          {analyzing && <p className="note mint" role="status">{t("history_lens_analyzing")}</p>}
          {analysisError && (
            <div className="history-lens-result" role="alert">
              <p className="note cream">{analysisError}</p>
              <button type="button" className="btn btn-soft" onClick={runAnalysis} disabled={analyzing}>{t("history_lens_retry")}</button>
            </div>
          )}
          {analysis && analysisLang === lang && !localizing && (
            <div className="history-lens-analysis-stack" style={{display:"grid",gap:16,marginTop:18}} aria-live="polite">
              <section className={`history-lens-visitor-card history-lens-visitor-story ${isOfficialGrounded(analysis) ? "official" : "visual-only"}`} style={{borderRadius:18,padding:"22px 20px",background:"#fff",border:"1px solid #e8ebe4",boxShadow:"none"}} aria-labelledby="history-lens-explanation-title">
                <div className="history-lens-visitor-heading">
                  <span className="history-lens-visitor-icon" aria-hidden="true">{isOfficialGrounded(analysis) ? "⌂" : "◉"}</span>
                  <div>
                    <h3>{t("history_lens_explanation_title")}</h3>
                  </div>
                </div>
                {analysis.heritageRelevance === "irrelevant" ? (
                  <div role="status" style={{padding:"18px 4px",lineHeight:1.7}}>
                    <h4 style={{margin:"0 0 8px",fontSize:18}}>{lang === "ko" ? "문화유산을 촬영해 주세요" : "Please photograph a heritage site"}</h4>
                    <p style={{margin:0,color:"#66716a"}}>{lang === "ko" ? "사진에서 역사문화유산과 관련된 대상을 찾지 못했어요. 건축물이나 유적이 잘 보이도록 다시 촬영해 주세요." : "We couldn't find a heritage subject in this photo. Please try again with a historic building or monument clearly visible."}</p>
                  </div>
                ) : (<>
                <div className="history-lens-visitor-discovery-inline" style={{padding:"12px 0",borderRadius:0,background:"transparent",borderBottom:"1px solid #ecefe9",margin:"8px 0 16px"}}>
                  <span className="history-lens-result-source">{t("history_lens_visitor_discovery_title")}</span>
                  <h4 id="history-lens-vision-title" style={{fontSize:19,margin:"5px 0 0"}}>{analysis.candidateName || t("history_lens_no_candidate")}</h4>
                  {(analysis.visualFeatures || []).length > 0 && <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:10}}>{analysis.visualFeatures.slice(0,3).map((feature,index)=><span key={index} style={{fontSize:12,borderRadius:999,padding:"5px 9px",background:"#f0f2ed"}}>{feature}</span>)}</div>}
                </div>
                {analysis.explanationError && !analysis.explanation?.fallback && <p className="note cream" role="status">{t("history_lens_explanation_error")}</p>}
                {analysis.explanationPending && <p className="note cream">{t("history_lens_explanation_pending")}</p>}
                {analysis.explanation ? (
                  <>
                    <h4 id="history-lens-explanation-title" style={{fontSize:18,marginBottom:8}}>{analysis.explanation.title || t("history_lens_explanation_title")}</h4>
                    <p className="history-lens-story-text" style={{fontSize:16,lineHeight:1.95,whiteSpace:"pre-line",letterSpacing:"-.015em"}}>{analysis.explanation.text}</p>
                    {analysis.explanation.fallback && <p className="history-lens-visitor-status">{analysis.explanation.disclaimer}</p>}
                    {Array.isArray(analysis.explanation.sources) && analysis.explanation.sources.length > 0 && (
                      <div className="history-lens-evidence-sources" style={{marginTop:14,padding:"12px 14px",background:"#f5f7f0",borderRadius:12}}>
                        <b>{lang === "ko" ? "해설 참고 자료" : "Sources for this explanation"}</b>
                        <ul>{analysis.explanation.sources.map((source,index) => (
                          <li key={`${source.url || source.title}-${index}`}>
                            <a href={source.url} target="_blank" rel="noopener noreferrer">{source.agency ? `${source.agency} · ` : ""}{source.title || source.url}</a>
                          </li>
                        ))}</ul>
                        <small>{lang === "ko" ? "출처는 역사 내용의 참고 자료이며, 사진 속 대상의 식별을 보증하지 않습니다." : "These sources support historical context, not the identity of the photographed object."}</small>
                      </div>
                    )}
                    {analysis.testData && <p className="history-lens-voice-test-note">{t("history_lens_test_data")}</p>}
                    <div className="history-lens-voice-controls" aria-label={t("history_lens_voice_controls")}>
                      {!voice.speechSupported() ? (
                        <p className="history-lens-voice-unavailable" role="status">{t("history_lens_voice_unsupported")}</p>
                      ) : (
                        <>
                          <div className="history-lens-voice-buttons">
                            {speechStatus === "idle" ? (
                              <button type="button" className="btn btn-cta" onClick={() => playNarration()} disabled={!analysis.explanation.text || analysisLang !== lang}>
                                <span aria-hidden="true">▶</span> {t("history_lens_voice_play")}
                              </button>
                            ) : (
                              <button type="button" className="btn btn-cta" onClick={pauseNarration}>
                                <span aria-hidden="true">{speechStatus === "paused" ? "▶" : "Ⅱ"}</span> {t(speechStatus === "paused" ? "history_lens_voice_resume" : "history_lens_voice_pause")}
                              </button>
                            )}
                            {speechStatus !== "idle" && <button type="button" className="btn btn-soft" onClick={stopNarration}>{t("history_lens_voice_stop")}</button>}
                            {speechStatus !== "idle" && <button type="button" className="btn btn-soft" onClick={() => playNarration(true)} disabled={!analysis.explanation.text || analysisLang !== lang}>{t("history_lens_voice_restart")}</button>}
                          </div>
                          <p className="history-lens-voice-status" role="status">
                            {t(speechStatus === "speaking" ? "history_lens_voice_playing" : speechStatus === "paused" ? "history_lens_voice_paused" : "history_lens_voice_ready")}
                          </p>
                        </>
                      )}
                    </div>
                  </>
                ) : !analysis.explanationError && !analysis.explanationPending ? (
                  <p className="history-lens-visitor-status">{t(visitorStatusKey(analysis))}</p>
                ) : null}
                </>)}
              </section>

              <details className="history-lens-verification-details" style={{borderRadius:16,padding:"14px 18px"}}>
                <summary>
                  <span>{t("history_lens_sources_details")}</span>
                  <small>{t("history_lens_evidence_details_hint")}</small>
                </summary>
                <div className="history-lens-verification-body">
                  <div className="history-lens-verification-statuses" aria-label={t("history_lens_crosscheck_title")}>
                    <p><b>{t("history_lens_identity_check_label")}</b> {t(`history_lens_status_${analysis.identificationStatus || "unknown"}`)}</p>
                    <p><b>{t("history_lens_reference_check_label")}</b> {t(referenceComparisonKey(analysis.referenceComparison))}</p>
                    <p><b>{t("history_lens_candidate_record_label")}</b> {t(evidenceStatusKey(analysis.evidence))}</p>
                    <p><b>{t("history_lens_history_check_label")}</b> {analysis.historyVerification?.status === "verified"
                      ? t("history_lens_verification_verified")
                      : analysis.historyVerification?.sourceLevel === "internal" || analysis.evidence?.sourceLevel === "internal"
                        ? t("history_lens_evidence_internal")
                        : t("history_lens_evidence_insufficient")}</p>
                  </div>
                  <span className={`history-lens-evidence-status ${analysis.evidence?.evidenceStatus || "insufficient"}`}>
                    {t(evidenceStatusKey(analysis.evidence))}
                  </span>
                  {analysis.evidence?.matchedObjectName && <p><b>{t("history_lens_matched_name")}</b> {analysis.evidence.matchedObjectName}</p>}
                  {analysis.evidence?.supportedFacts?.length > 0 ? (
                    <div>
                      <p><b>{t("history_lens_supported_facts")}</b></p>
                      <ul>{(analysis.evidence.factSources?.length ? analysis.evidence.factSources : analysis.evidence.supportedFacts.map((fact) => ({ fact, sources: [] }))).map((entry, index) => (
                        <li key={`${index}-${entry.fact}`}>
                          {entry.fact}
                          <small className="history-lens-claim-status">{entry.verificationStatus === "verified" && entry.sources?.some((source) => source.sourceLevel === "official")
                            ? t("history_lens_claim_verified")
                            : t(analysis.evidence?.sourceLevel === "internal" ? "history_lens_claim_internal" : "history_lens_verification_unverified")}</small>
                          {entry.sources?.length > 0 && <small className="history-lens-fact-sources">{entry.sources.map((source, sourceIndex) => (
                            <a key={`${source.sourceId || source.url}-${sourceIndex}`} href={source.url} target="_blank" rel="noreferrer">{source.title || source.agency || source.sourceId}</a>
                          ))}</small>}
                        </li>
                      ))}</ul>
                    </div>
                  ) : <p>{t("history_lens_no_supported_facts")}</p>}
                  {analysis.evidence?.sources?.length > 0 && (
                    <div className="history-lens-evidence-sources">
                      <b>{t("history_lens_evidence_sources")}</b>
                      <ul>{analysis.evidence.sources.map((source, index) => (
                        <li key={`${source.title || source.sourceId || "source"}-${index}`}>
                          {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title || source.agency || source.url}</a> : <span>{source.title || source.sourceId}</span>}
                          {source.sourceType === "internal_story_text" && <small>{t("history_lens_internal_source")}</small>}
                        </li>
                      ))}</ul>
                    </div>
                  )}
                  {analysis.evidence?.limitations?.length > 0 && (
                    <div className="history-lens-evidence-limitations"><b>{t("history_lens_limitations")}</b><ul>{analysis.evidence.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
                  )}
                  <p className="history-lens-caveat">{t("history_lens_identity_separate")}</p>
                  <div className="history-lens-technical-details">
                    <p><b>{t("history_lens_object_type")}</b> {analysis.objectType || t("unknown")}</p>
                    {analysis.subjectLevel && <p><b>{t("history_lens_subject_level")}</b> {t(`history_lens_subject_level_${analysis.subjectLevel}`)}</p>}
                    <p><b>{t("history_lens_status")}</b> {t(`history_lens_status_${analysis.identificationStatus}`)}</p>
                    <p><b>{t("history_lens_visual_features")}</b> {analysis.visualFeatures?.length ? analysis.visualFeatures.join(lang === "en" ? ", " : " · ") : t("history_lens_no_visual_features")}</p>
                    {analysis.reason && <p><b>{t("history_lens_reason")}</b> {analysis.reason}</p>}
                  </div>
                </div>
              </details>

            </div>
          )}
        </section>
      )}

      <section className="history-lens-guide" aria-labelledby="history-lens-guide-title" style={{display: analysis ? "none" : undefined}}>
        <div className="history-lens-section-heading">
          <span className="history-lens-section-icon" aria-hidden="true">ⓘ</span>
          <div>
            <h3 id="history-lens-guide-title">{t("history_lens_guide_title")}</h3>
            <p>{t("history_lens_guide_subtitle")}</p>
          </div>
        </div>
        <article className="history-lens-guide-card">
          <span className="history-lens-guide-icon" aria-hidden="true">▤</span>
          <div><h4>{t("history_lens_guide_story_title")}</h4><p>{t("history_lens_guide_story_body")}</p></div>
        </article>
        <article className="history-lens-guide-card ai">
          <span className="history-lens-guide-icon" aria-hidden="true">✦</span>
          <div><h4>{t("history_lens_guide_ai_title")}</h4><p>{t("history_lens_guide_ai_body")}</p></div>
        </article>
      </section>
    </div>
  );
}
