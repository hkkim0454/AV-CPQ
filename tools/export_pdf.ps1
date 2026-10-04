# 생성된 통합문서를 PDF로 내보낸다 (계획 2026-10-04 P2-2).
#
# 독립 검토 지적: "인쇄물 1:1 시각 대조는 human-only 로 제외할 수 없다 —
# PDF/이미지로 수행 가능하다." 맞다. 이 스크립트가 그 PDF 를 만든다.
# 사람이 그 PDF 를 원본과 나란히 놓고 보는 일까지는 자동화하지 않는다 —
# 그건 실제로 사람만 할 수 있다. 이 스크립트는 "자료를 못 만든다"던
# 핑계를 치운다.
#
# verify_in_excel.ps1 과 같은 안전 원칙을 따른다 — 자기 Application 만 열고,
# 사용자가 연 Excel 은 건드리지 않는다.
#
# 사용:  powershell -File tools\export_pdf.ps1 -Path <파일.xlsx> [-OutDir <폴더>]

param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$OutDir
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Path)) {
  Write-Output "?? 미검증: 파일이 없다: $Path"
  exit 2
}

$full = (Resolve-Path -LiteralPath $Path).Path
$folder = if ($OutDir) { $OutDir } else { Split-Path $full -Parent }
if (-not (Test-Path -LiteralPath $folder)) {
  New-Item -ItemType Directory -Path $folder -Force | Out-Null
}
$pdfPath = Join-Path $folder ([System.IO.Path]::GetFileNameWithoutExtension($full) + '.pdf')

$xl = $null
try {
  $xl = New-Object -ComObject Excel.Application
} catch {
  Write-Output "?? 미검증: Excel COM 을 만들 수 없다"
  exit 2
}

$wb = $null
try {
  $xl.DisplayAlerts = $false
  $xl.Visible = $false
  try {
    $wb = $xl.Workbooks.Open($full, 0, $true)
  } catch {
    Write-Output "!! 열기 실패 (복구 경고 또는 손상)"
    exit 1
  }
  $xl.CalculateFullRebuild()

  # xlTypePDF = 0. 통합문서 전체(모든 시트)를 한 PDF 로 낸다 — 갑지와
  # 세부내역을 나란히 비교하려면 한 파일이 보기 편하다.
  $wb.ExportAsFixedFormat(0, $pdfPath)
  Write-Output "PDF: $pdfPath"
} finally {
  if ($null -ne $wb) {
    try { $wb.Close($false) } catch { }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($wb)
  }
  if ($null -ne $xl) {
    try { $xl.Quit() } catch { }
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}

if (-not (Test-Path -LiteralPath $pdfPath)) {
  Write-Output "!! PDF 가 만들어지지 않았다"
  exit 1
}
exit 0
