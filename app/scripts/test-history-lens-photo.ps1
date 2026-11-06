# Local-only smoke test for the existing POST /api/analyze-image handler.
# Requires a prior successful run of test-gemini-connection.ps1 and an authorized, user-owned photo.
# The reference-photo dataset is explicitly disabled for this test.

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $appRoot '.env.local'

if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    Write-Output 'app/.env.local을 찾지 못했습니다.'
    exit 2
}

$textConfirmed = Read-Host 'test-gemini-connection.ps1에서 텍스트 생성 요청 성공을 확인했나요? 계속하려면 YES 입력'
if ($textConfirmed -cne 'YES') {
    Write-Output '텍스트 생성 성공이 확인되지 않아 사진 요청을 중단했습니다.'
    exit 2
}

$photoAuthorized = Read-Host '직접 촬영했거나 외부 AI 분석 전송 권한이 확인된 사진인가요? 계속하려면 YES 입력'
if ($photoAuthorized -cne 'YES') {
    Write-Output '사진 사용 권한이 확인되지 않아 요청을 중단했습니다.'
    exit 2
}

$photoPathInput = Read-Host '테스트할 본인 사진의 전체 경로 입력 (JPG, PNG, WEBP, 3MB 이하)'
if (-not (Test-Path -LiteralPath $photoPathInput -PathType Leaf)) {
    Write-Output '사진 파일을 찾지 못했습니다.'
    exit 2
}
$photoPath = (Resolve-Path -LiteralPath $photoPathInput).Path
$extension = [System.IO.Path]::GetExtension($photoPath).ToLowerInvariant()
$mimeType = switch ($extension) {
    '.jpg' { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    '.png' { 'image/png' }
    '.webp' { 'image/webp' }
    default { $null }
}
if (-not $mimeType) {
    Write-Output '지원 형식이 아닙니다. JPG, PNG, WEBP만 사용할 수 있습니다.'
    exit 2
}
if ((Get-Item -LiteralPath $photoPath).Length -gt 3MB) {
    Write-Output '사진이 3MB를 초과합니다. 3MB 이하 파일을 사용하세요.'
    exit 2
}

$spotId = (Read-Host '장소 ID 입력 (simujang / jeongneung / uiryeong)').Trim().ToLowerInvariant()
$spotName = switch ($spotId) {
    'simujang' { '심우장' }
    'jeongneung' { '정릉' }
    'uiryeong' { '의릉' }
    default { $null }
}
if (-not $spotName) {
    Write-Output '알 수 없는 장소 ID입니다.'
    exit 2
}
$lang = (Read-Host '응답 언어 입력 (ko / en)').Trim().ToLowerInvariant()
if ($lang -notin @('ko', 'en')) {
    Write-Output '언어는 ko 또는 en이어야 합니다.'
    exit 2
}

$nodeCode = @'
import { readFile } from 'node:fs/promises';
import analyzeImage from './api/analyze-image.js';

const [photoPath, spotId, spotName, lang, mimeType] = process.argv.slice(2);
process.env.GEMINI_IMAGE_MOCK = '0';
process.env.GEMINI_IMAGE_REFERENCE_MODE = '0';
process.env.GEMINI_IMAGE_REFERENCE_EXTERNAL_OK = '0';
// Keep the smoke-test output free of model text, photo path, API key, and raw errors.
console.warn = () => {};
console.error = () => {};

try {
  const bytes = await readFile(photoPath);
  if (bytes.length > 3 * 1024 * 1024) throw new Error('photo_too_large');
  const response = {
    statusCode: 0,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return body; },
  };
  await analyzeImage({ method: 'POST', body: {
    spotId, spotName, lang, mimeType, imageBase64: bytes.toString('base64'),
  } }, response);

  const result = response.body || {};
  const summary = {
    httpStatus: response.statusCode,
    source: result.source || null,
    testData: result.testData === true,
    candidateNamePresent: typeof result.candidateName === 'string' && result.candidateName.trim().length > 0,
    identificationStatus: ['identified', 'uncertain', 'unknown'].includes(result.identificationStatus) ? result.identificationStatus : 'invalid_or_missing',
    evidenceStatus: ['supported', 'insufficient', 'conflicting'].includes(result.evidence?.evidenceStatus) ? result.evidence.evidenceStatus : 'invalid_or_missing',
    explanationReturned: typeof result.explanation?.text === 'string' && result.explanation.text.trim().length > 0,
    explanationType: ['grounded', 'estimated'].includes(result.explanation?.type) ? result.explanation.type : null,
    explanationErrorCode: typeof result.explanationError?.code === 'string' ? result.explanationError.code : null,
    apiErrorCode: typeof result.code === 'string' ? result.code : null,
  };
  console.log(JSON.stringify(summary));
  if (summary.httpStatus !== 200 || summary.source !== 'gemini' || summary.testData || !summary.candidateNamePresent || summary.identificationStatus === 'invalid_or_missing' || summary.evidenceStatus === 'invalid_or_missing' || !summary.explanationReturned || !summary.explanationType) process.exitCode = 1;
} catch (error) {
  const code = error?.message === 'photo_too_large' ? 'photo_too_large' : 'local_test_failed';
  console.log(JSON.stringify({ result: 'failed', code }));
  process.exitCode = 1;
}
'@

# Ensure Node loads the project .env.local instead of inheriting a possibly stale process key.
$hadProcessKey = Test-Path Env:\GEMINI_API_KEY
$savedProcessKey = $env:GEMINI_API_KEY
$savedReferenceMode = $env:GEMINI_IMAGE_REFERENCE_MODE
$savedReferencePermission = $env:GEMINI_IMAGE_REFERENCE_EXTERNAL_OK
$savedImageMock = $env:GEMINI_IMAGE_MOCK
try {
    Remove-Item Env:\GEMINI_API_KEY -ErrorAction SilentlyContinue
    $env:GEMINI_IMAGE_REFERENCE_MODE = '0'
    $env:GEMINI_IMAGE_REFERENCE_EXTERNAL_OK = '0'
    $env:GEMINI_IMAGE_MOCK = '0'
    Push-Location $appRoot
    try {
        $nodeCode | & node --env-file-if-exists=.env.local --input-type=module - $photoPath $spotId $spotName $lang $mimeType
        if ($LASTEXITCODE -ne 0) {
            Write-Output '사진 분석 smoke test가 실패했습니다. 위의 상태 코드만 확인하세요. 키와 원문 오류는 출력하지 않았습니다.'
            exit 1
        }
    }
    finally { Pop-Location }
}
finally {
    if ($hadProcessKey) { $env:GEMINI_API_KEY = $savedProcessKey } else { Remove-Item Env:\GEMINI_API_KEY -ErrorAction SilentlyContinue }
    if ($null -eq $savedReferenceMode) { Remove-Item Env:\GEMINI_IMAGE_REFERENCE_MODE -ErrorAction SilentlyContinue } else { $env:GEMINI_IMAGE_REFERENCE_MODE = $savedReferenceMode }
    if ($null -eq $savedReferencePermission) { Remove-Item Env:\GEMINI_IMAGE_REFERENCE_EXTERNAL_OK -ErrorAction SilentlyContinue } else { $env:GEMINI_IMAGE_REFERENCE_EXTERNAL_OK = $savedReferencePermission }
    if ($null -eq $savedImageMock) { Remove-Item Env:\GEMINI_IMAGE_MOCK -ErrorAction SilentlyContinue } else { $env:GEMINI_IMAGE_MOCK = $savedImageMock }
    $savedProcessKey = $null
}
