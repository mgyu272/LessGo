#!/usr/bin/env node
// One-image, real Gemini Vision smoke test. Never scans or loads the reference dataset.
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { performance } from 'node:perf_hooks';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maxBytes = 3 * 1024 * 1024;
const allowedModels = new Set([
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
]);
const mimeByExtension = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
]);

function usage() {
  console.log('사용법: node scripts/test-gemini-vision.mjs --image "<직접 촬영했거나 전송 권한이 확인된 사진 경로>"');
  console.log('JPG, PNG, WEBP 사진 1장만 지원하며 3MB 이하여야 합니다.');
}

function readDotEnvValue(text, name) {
  const prefix = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*?)\\s*$`);
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(prefix);
    if (!match) continue;
    let value = match[1];
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return '';
}

function mimeMatches(bytes, mimeType) {
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safeFailure(status, body) {
  const messages = {
    401: 'API 키 인증 오류 (HTTP 401)',
    403: 'API 권한 오류 (HTTP 403)',
    404: '모델 또는 API 경로 오류 (HTTP 404)',
    429: '사용량 또는 할당량 제한 (HTTP 429)',
    503: 'Gemini 서비스 일시 이용 불가 (HTTP 503)',
  };
  if (messages[status]) return messages[status];
  if (status) return `Gemini 요청 실패 (HTTP ${status})`;
  if (body?.name === 'AbortError' || body?.name === 'TimeoutError') return '요청 시간 초과';
  return '네트워크 연결 오류';
}

async function askYes(prompt) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try { return (await rl.question(prompt)).trim() === 'YES'; }
  finally { rl.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--image' || !args[1]) {
    usage();
    return 2;
  }

  const selectedPath = path.resolve(args[1]);
  let realPhotoPath;
  try { realPhotoPath = await realpath(selectedPath); }
  catch {
    console.log('사진 파일을 찾을 수 없습니다. 지정한 이미지 파일 경로를 확인하세요.');
    return 2;
  }

  const referenceRoot = path.resolve(appRoot, 'server-data', 'heritage_reference_4a');
  if (isInside(referenceRoot, realPhotoPath)) {
    console.log('참고 사진 데이터 폴더의 파일은 이 테스트에서 사용할 수 없습니다. 본인 사진을 지정하세요.');
    return 2;
  }

  const mimeType = mimeByExtension.get(path.extname(realPhotoPath).toLowerCase());
  if (!mimeType) {
    console.log('지원하지 않는 이미지 형식입니다. JPG, PNG, WEBP 중 하나를 지정하세요.');
    return 2;
  }

  const fileInfo = await stat(realPhotoPath);
  if (!fileInfo.isFile()) {
    console.log('지정한 경로가 파일이 아닙니다.');
    return 2;
  }
  if (fileInfo.size > maxBytes) {
    console.log('사진 용량이 3MB를 초과해 요청을 차단했습니다.');
    return 2;
  }

  const imageBytes = await readFile(realPhotoPath);
  if (!mimeMatches(imageBytes, mimeType)) {
    console.log('파일 확장자와 실제 이미지 형식이 일치하지 않아 요청을 차단했습니다.');
    return 2;
  }

  const authorized = await askYes('직접 촬영했거나 외부 Gemini 전송 권한이 확인된 사진인가요? 전송하려면 YES 입력: ');
  if (!authorized) {
    console.log('사진 사용 권한을 확인하지 않아 요청을 중단했습니다.');
    return 2;
  }

  const envText = await readFile(path.join(appRoot, '.env.local'), 'utf8').catch(() => '');
  const apiKey = process.env.GEMINI_API_KEY || readDotEnvValue(envText, 'GEMINI_API_KEY');
  if (!apiKey) {
    console.log('GEMINI_API_KEY를 환경변수 또는 app/.env.local에서 찾지 못했습니다.');
    return 2;
  }

  const configuredModel = process.env.GEMINI_IMAGE_MODEL || readDotEnvValue(envText, 'GEMINI_IMAGE_MODEL') ||
    process.env.GEMINI_MODEL || readDotEnvValue(envText, 'GEMINI_MODEL') || 'gemini-3.5-flash-lite';
  const model = configuredModel.replace(/^models\//u, '');
  if (!/^[A-Za-z0-9._-]+$/u.test(model) || !allowedModels.has(model)) {
    console.log('설정된 이미지 모델은 앱의 이미지 입력 지원 목록에 없습니다. GEMINI_IMAGE_MODEL 설정을 확인하세요.');
    return 2;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const started = performance.now();
  let status = 0;
  let resultText = '';
  let failure = null;
  try {
    const modelsResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
      headers: { 'x-goog-api-key': apiKey },
      signal: controller.signal,
    });
    if (!modelsResponse.ok) {
      status = modelsResponse.status;
      failure = safeFailure(status);
    } else {
      const modelsPayload = await modelsResponse.json();
      const listedModel = modelsPayload.models?.find((item) => item.name?.replace(/^models\//u, '') === model);
      if (!listedModel || !listedModel.supportedGenerationMethods?.includes('generateContent')) {
        failure = '설정 모델이 실제 모델 목록에 없거나 generateContent를 지원하지 않습니다.';
      } else {
        // The model-list method metadata confirms generateContent only; it may not
        // declare image modalities. Image support is verified by this real request.
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [
              { text: 'Describe the main object visible in this image.' },
              { inline_data: { mime_type: mimeType, data: imageBytes.toString('base64') } },
            ] }],
            generationConfig: { maxOutputTokens: 120, temperature: 0.2 },
          }),
          signal: controller.signal,
        });
        status = response.status;
        if (response.ok) {
          const payload = await response.json();
          resultText = (payload.candidates?.[0]?.content?.parts || []).map((part) => part.text || '').join(' ').trim();
          if (!resultText) failure = '모델 응답에 분석 텍스트가 없습니다.';
        } else {
          failure = safeFailure(status);
        }
      }
    }
  } catch (error) {
    failure = safeFailure(status, error);
  } finally {
    clearTimeout(timeout);
    // Avoid retaining the image buffer or secret longer than needed.
    imageBytes.fill(0);
  }

  const elapsedSeconds = ((performance.now() - started) / 1000).toFixed(1);
  const succeeded = status >= 200 && status < 300 && Boolean(resultText);
  console.log(`사용 모델명: ${model}`);
  console.log(`HTTP 상태: ${status || '없음'}`);
  console.log(`요청 소요 시간: ${elapsedSeconds}초`);
  console.log(`이미지 분석 성공 여부: ${succeeded ? '성공' : '실패'}`);
  if (succeeded) {
    const shortDescription = resultText.replace(/\s+/gu, ' ').slice(0, 240);
    console.log(`인식 설명: ${shortDescription}`);
  } else {
    console.log(`실패 원인: ${failure || '응답 분석 실패'}`);
  }
  return succeeded ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }).catch(() => {
  console.log('테스트를 시작하지 못했습니다. 실행 환경과 파일 상태를 확인하세요.');
  process.exitCode = 1;
});
