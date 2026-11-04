# Gemini API 연결 진단기
# app/.env.local에서 키를 읽고, 목록에 있는 Flash 계열 generateContent 모델을 최대 3개까지 테스트합니다.
# 키, 인증 헤더, 요청 URL, 원문 오류 응답은 출력하지 않습니다.

$ErrorActionPreference = 'Stop'
$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.env.local'

function Get-EnvValue([string]$Text, [string]$Name) {
    $escaped = [regex]::Escape($Name)
    $found = $null
    foreach ($line in ($Text -split "`r?`n")) {
        if ($line -match "^\s*$escaped\s*=\s*(.*)$") { $found = $Matches[1].Trim() }
    }
    if ($null -ne $found -and $found.Length -ge 2) {
        if (($found.StartsWith('"') -and $found.EndsWith('"')) -or ($found.StartsWith("'") -and $found.EndsWith("'"))) {
            $found = $found.Substring(1, $found.Length - 2)
        }
    }
    return $found
}

function Get-FailureCategory([int]$StatusCode) {
    switch ($StatusCode) {
        401 { return '인증 오류 (HTTP 401)' }
        403 { return '인증 또는 API 권한 오류 (HTTP 403)' }
        404 { return '모델 또는 API 경로 오류 (HTTP 404)' }
        429 { return '무료 사용량 또는 할당량 초과 (HTTP 429)' }
        default { return "기타 HTTP 오류 (HTTP $StatusCode)" }
    }
}

function Invoke-GeminiHttp([string]$Method, [string]$Uri, [string]$JsonBody, [int]$TimeoutSeconds) {
    $request = $null
    $response = $null
    $timeoutSource = $null
    try {
        $timeoutSource = [System.Threading.CancellationTokenSource]::new()
        $timeoutSource.CancelAfter([TimeSpan]::FromSeconds($TimeoutSeconds))
        $httpMethod = if ($Method -eq 'GET') { [System.Net.Http.HttpMethod]::Get } else { [System.Net.Http.HttpMethod]::Post }
        $request = [System.Net.Http.HttpRequestMessage]::new($httpMethod, $Uri)
        [void]$request.Headers.TryAddWithoutValidation('x-goog-api-key', $script:ApiKey)
        if ($Method -eq 'POST') {
            $request.Content = [System.Net.Http.StringContent]::new($JsonBody, [System.Text.Encoding]::UTF8, 'application/json')
        }
        $response = $script:HttpClient.SendAsync($request, $timeoutSource.Token).GetAwaiter().GetResult()
        $bodyText = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            IsSuccess = $response.IsSuccessStatusCode
            BodyText = $bodyText
        }
    }
    finally {
        if ($null -ne $response) { $response.Dispose() }
        if ($null -ne $request) { $request.Dispose() }
        if ($null -ne $timeoutSource) { $timeoutSource.Dispose() }
    }
}

if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    Write-Output '환경변수 파일을 찾지 못했습니다: app/.env.local'
    exit 2
}

$envText = [System.IO.File]::ReadAllText($envFile)
$script:ApiKey = Get-EnvValue $envText 'GEMINI_API_KEY'
$configuredModel = Get-EnvValue $envText 'GEMINI_MODEL'
$envText = $null

if ([string]::IsNullOrWhiteSpace($script:ApiKey)) {
    Write-Output 'GEMINI_API_KEY가 비어 있습니다. app/.env.local을 확인하세요.'
    exit 2
}

if (-not [string]::IsNullOrWhiteSpace($env:GEMINI_MODEL)) { $configuredModel = $env:GEMINI_MODEL.Trim() }
if ([string]::IsNullOrWhiteSpace($configuredModel)) { $configuredModel = 'gemini-3.5-flash-lite' }
$configuredModel = $configuredModel -replace '^models/', ''
Write-Output "설정 모델: $configuredModel"

Add-Type -AssemblyName System.Net.Http
$script:HttpClient = New-Object System.Net.Http.HttpClient
$script:HttpClient.Timeout = [System.Threading.Timeout]::InfiniteTimeSpan
$modelListTimeoutSeconds = 15
$textGenerationTimeoutSeconds = 60

try {
    # First discover models available to this key. Never guess a model if this fails.
    try {
        $modelResponse = Invoke-GeminiHttp 'GET' 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000' $null $modelListTimeoutSeconds
    }
    catch [System.Threading.Tasks.TaskCanceledException] {
        Write-Output '모델 목록 조회 실패: 네트워크 시간 초과'
        exit 1
    }
    catch [System.Net.Http.HttpRequestException] {
        Write-Output '모델 목록 조회 실패: 네트워크 또는 DNS 연결 오류 (Codex 실행 환경의 외부 네트워크 제한일 수 있음)'
        exit 1
    }
    catch {
        Write-Output '모델 목록 조회 실패: 네트워크 요청 오류'
        exit 1
    }

    if (-not $modelResponse.IsSuccess) {
        Write-Output "모델 목록 조회 실패: $(Get-FailureCategory $modelResponse.StatusCode)"
        exit 1
    }

    try { $modelPayload = $modelResponse.BodyText | ConvertFrom-Json }
    catch {
        Write-Output '모델 목록 조회 실패: 응답 형식 오류 (민감한 응답 내용은 출력하지 않음)'
        exit 1
    }

    $textModels = @($modelPayload.models | Where-Object {
        $_.name -and $_.supportedGenerationMethods -contains 'generateContent'
    })
    if ($textModels.Count -eq 0) {
        Write-Output '모델 목록은 조회됐지만 generateContent를 지원하는 사용 가능 모델이 없습니다.'
        exit 1
    }

    # Only use Flash models actually returned by the API. Prefer the configured
    # model first, then try at most two different listed Flash models.
    $flashModels = @($textModels | Where-Object { $_.name -match '(?i)flash' })
    if ($flashModels.Count -eq 0) {
        Write-Output '모델 목록은 조회됐지만 generateContent를 지원하는 Flash 계열 모델이 없습니다.'
        exit 1
    }
    Write-Output "모델 목록 조회: 성공 ($($textModels.Count)개 텍스트 생성 모델)"

    $orderedModels = @()
    $configuredListedModel = $flashModels | Where-Object { (($_.name -replace '^models/', '') -eq $configuredModel) } | Select-Object -First 1
    if ($null -ne $configuredListedModel) { $orderedModels += $configuredListedModel }
    foreach ($candidate in $flashModels) {
        $candidateName = ([string]$candidate.name) -replace '^models/', ''
        if ($candidateName -ne $configuredModel -and -not ($orderedModels | Where-Object { (($_.name -replace '^models/', '') -eq $candidateName) })) {
            $orderedModels += $candidate
        }
    }
    $orderedModels = @($orderedModels | Select-Object -First 3)

    $requestBody = @{
        contents = @(@{ role = 'user'; parts = @(@{ text = 'Reply with exactly: Less GO Gemini connection test OK.' }) })
        generationConfig = @{ maxOutputTokens = 24; temperature = 0 }
    } | ConvertTo-Json -Depth 8 -Compress

    $successModel = $null
    foreach ($listedModel in $orderedModels) {
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $modelName = ([string]$listedModel.name) -replace '^models/', ''
        if ($modelName -notmatch '^[A-Za-z0-9._-]+$') {
            Write-Output '모델 목록의 이름 형식이 예상과 달라 요청을 중단했습니다.'
            exit 1
        }

        try {
            $generateUri = 'https://generativelanguage.googleapis.com/v1beta/models/{0}:generateContent' -f $modelName
            $textResponse = Invoke-GeminiHttp 'POST' $generateUri $requestBody $textGenerationTimeoutSeconds
        }
        catch [System.Threading.Tasks.TaskCanceledException] {
            $stopwatch.Stop()
            Write-Output "$modelName | 소요: $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1))초 | HTTP 없음 (timeout) | 성공: 아니오"
            continue
        }
        catch [System.Net.Http.HttpRequestException] {
            $stopwatch.Stop()
            Write-Output "$modelName | 소요: $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1))초 | HTTP 없음 (network error) | 성공: 아니오"
            break
        }
        catch {
            $stopwatch.Stop()
            Write-Output "$modelName | 소요: $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1))초 | HTTP 없음 (request error) | 성공: 아니오"
            break
        }

        $modelSucceeded = $false
        if ($textResponse.IsSuccess) {
            try {
                $textPayload = $textResponse.BodyText | ConvertFrom-Json
                $generatedText = @($textPayload.candidates[0].content.parts | ForEach-Object { $_.text }) -join ''
                $modelSucceeded = -not [string]::IsNullOrWhiteSpace($generatedText)
            }
            catch { $modelSucceeded = $false }
        }

        $stopwatch.Stop()
        $successLabel = if ($modelSucceeded) { '예' } else { '아니오' }
        Write-Output "$modelName | 소요: $([math]::Round($stopwatch.Elapsed.TotalSeconds, 1))초 | HTTP $($textResponse.StatusCode) | 성공: $successLabel"
        if ($modelSucceeded) {
            $successModel = $modelName
            break
        }

        # Continue only for temporary availability (503). Authentication and
        # quota errors (401/403/429), and all other HTTP statuses, stop here.
        if ($textResponse.StatusCode -ne 503) { break }
    }

    if ($successModel) {
        Write-Output "성공 모델: $successModel"
    }
    else {
        Write-Output '성공 모델: 없음'
        exit 1
    }
}
finally {
    $script:ApiKey = $null
    $modelPayload = $null
    $textPayload = $null
    $modelResponse = $null
    $textResponse = $null
    $script:HttpClient.Dispose()
}
