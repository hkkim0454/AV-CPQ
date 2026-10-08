# tests/e2e/excel-reconciliation.spec.ts에서 실제 내려받은 6종을 검증한다.
# 먼저: npx playwright test tests/e2e/excel-reconciliation.spec.ts
# 이 스크립트는 파일을 재생성하지 않는다. Excel이 없으면 미검증(2)이다.
param(
  [string]$ResultsDir = 'test-results',
  [string]$LogDir = '.local/codex-review/download-excel'
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$resultsRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot $ResultsDir))
$logsRoot = [IO.Path]::GetFullPath((Join-Path $repoRoot $LogDir))
if (-not (Test-Path -LiteralPath $resultsRoot -PathType Container)) {
  Write-Output '미검증: 브라우저 다운로드 시험 결과가 없습니다.'
  exit 2
}
New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
$files = @(Get-ChildItem -LiteralPath $resultsRoot -Recurse -File -Filter '*.xlsx')
$failureCount = 0
$unverifiedCount = 0
$passedCount = 0
foreach ($profile in @('ds', 'general')) {
  foreach ($suffix in @('0-grade0', '1-grade2', '4-grade1')) {
    $stem = "$profile-$suffix"
    $matches = @($files | Where-Object Name -eq "$stem.xlsx")
    if ($matches.Count -ne 1) {
      Write-Output "미검증: $stem.xlsx 파일이 정확히 하나여야 합니다 (실제 $($matches.Count))."
      $unverifiedCount++
      continue
    }
    $workbook = $matches[0]
    $expectedPath = Join-Path $workbook.DirectoryName "$stem.expected.json"
    $layoutPath = Join-Path $workbook.DirectoryName "$stem.layout.json"
    if (-not (Test-Path -LiteralPath $expectedPath) -or -not (Test-Path -LiteralPath $layoutPath)) {
      Write-Output "미검증: $stem 기대값/주소 파일이 없습니다."
      $unverifiedCount++
      continue
    }
    $logPath = Join-Path $logsRoot "$stem.log"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'verify_in_excel.ps1') `
      -Path $workbook.FullName -Expected $expectedPath -LayoutManifest $layoutPath *> $logPath
    $verifyExit = $LASTEXITCODE
    if ($verifyExit -eq 0) { $passedCount++; Write-Output "통과: $stem" }
    elseif ($verifyExit -eq 2) { $unverifiedCount++; Write-Output "미검증: $stem ($logPath)" }
    else { $failureCount++; Write-Output "실패: $stem ($logPath)" }
  }
}
Write-Output "Excel 실다운로드 대사: 통과 $passedCount / 실패 $failureCount / 미검증 $unverifiedCount"
if ($failureCount -gt 0) { exit 1 }
if ($unverifiedCount -gt 0 -or $passedCount -ne 6) { exit 2 }
exit 0
