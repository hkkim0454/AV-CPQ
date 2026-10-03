# 생성된 통합문서를 실제 Excel에서 열어 재계산·인쇄·수식 오류를 검증한다.
#
# 설계서 §9.7 / §11 단계 7: "Excel을 사용할 수 없으면 최종 Excel 검증을 통과했다고
# 보고하지 않는다." 이 스크립트가 그 검증이다. 브라우저 테스트로 대체하지 않는다.
#
# 사용:  powershell -File tools\verify_in_excel.ps1 <파일.xlsx> [기대값.json]
#
# 기대값 JSON 형식 (tests가 만든다):
#   { "cover": { "H13": "3580000", ... }, "sheets": { "교육장 영상": { "J28": "..." } } }

param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Expected
)

$ErrorActionPreference = 'Stop'
$failures = New-Object System.Collections.ArrayList

function Fail([string]$message) {
  [void]$failures.Add($message)
  Write-Output "  !! $message"
}

Get-Process EXCEL -ErrorAction SilentlyContinue | ForEach-Object { $_.Kill() }
Start-Sleep -Milliseconds 800

$full = (Resolve-Path $Path).Path
Write-Output "## Excel 검증: $full"

$xl = New-Object -ComObject Excel.Application
$xl.DisplayAlerts = $false
$xl.AskToUpdateLinks = $false

try {
  # 복구 모드를 쓰지 않고 연다. 손상이면 여기서 예외가 난다.
  $wb = $xl.Workbooks.Open($full, 0, $true)
} catch {
  Write-Output "  !! 열기 실패 (복구 경고 또는 손상): $($_.Exception.Message)"
  $xl.Quit()
  exit 1
}

Write-Output "시트 $($wb.Worksheets.Count)장"
foreach ($ws in $wb.Worksheets) {
  Write-Output ("  '{0}' printArea={1} titles='{2}' orient={3} pages={4} shapes={5}" -f `
      $ws.Name, $ws.PageSetup.PrintArea, $ws.PageSetup.PrintTitleRows, `
      $ws.PageSetup.Orientation, $ws.PageSetup.Pages.Count, $ws.Shapes.Count)
  if ($ws.Visible -ne -1) { Fail "숨김 시트: $($ws.Name)" }
}

# --- 외부 링크 (설계서 §9.6: 생성 파일은 외부 원본 없이 계산이 완결돼야 한다) ---
$links = $wb.LinkSources(1)
if ($null -ne $links) { foreach ($l in $links) { Fail "외부 링크: $l" } }
else { Write-Output "외부 링크: 없음" }

# --- 전체 재계산 ---
$xl.CalculateFullRebuild()

# --- 수식 오류 셀 (#REF!, #VALUE!, #NAME? …) ---
$errorCount = 0
foreach ($ws in $wb.Worksheets) {
  try {
    # xlCellTypeFormulas(-4123) + xlErrors(16)
    $errs = $ws.UsedRange.SpecialCells(-4123, 16)
    if ($null -ne $errs) {
      foreach ($c in $errs.Cells) {
        Fail "수식 오류 $($ws.Name)!$($c.Address(0,0)) = $($c.Text)"
        $errorCount++
      }
    }
  } catch {
    # SpecialCells는 해당 셀이 없으면 예외를 던진다 — 오류 0개라는 뜻이다.
  }
}
Write-Output "수식 오류 셀: $errorCount"

# --- 기대값 대조 ---
if ($Expected -and (Test-Path $Expected)) {
  $exp = Get-Content $Expected -Raw -Encoding UTF8 | ConvertFrom-Json
  $checked = 0
  foreach ($sheetName in $exp.PSObject.Properties.Name) {
    $ws = $null
    try { $ws = $wb.Worksheets.Item($sheetName) } catch { Fail "시트 없음: $sheetName"; continue }
    foreach ($cellRef in $exp.$sheetName.PSObject.Properties.Name) {
      $want = [string]$exp.$sheetName.$cellRef
      $got = $ws.Range($cellRef).Value2
      $gotText = if ($null -eq $got) { "" } elseif ($got -is [double]) { $got.ToString("R") } else { [string]$got }
      $checked++
      if ($gotText -ne $want) {
        Fail "$sheetName!$cellRef  기대=$want  Excel=$gotText"
      }
    }
  }
  Write-Output "대조한 셀: $checked"
}

# --- 다페이지 인쇄 (설계서 §9.7, 인수 기준 A10, 열린 항목 O2a) ---
# "다페이지 머리글·폭·잘림 검증"
foreach ($ws in $wb.Worksheets) {
  $area = $ws.PageSetup.PrintArea
  if (-not $area) { Fail "인쇄 영역이 없다: $($ws.Name)"; continue }

  # 인쇄 영역이 쓰인 범위를 전부 덮는가 — 행이 잘리면 여기서 걸린다
  $areaRange = $ws.Range($area)
  $lastAreaRow = $areaRange.Row + $areaRange.Rows.Count - 1
  $lastUsedRow = $ws.UsedRange.Row + $ws.UsedRange.Rows.Count - 1
  if ($lastUsedRow -gt $lastAreaRow) {
    Fail "$($ws.Name): 인쇄 영역이 $lastAreaRow 행까지인데 내용은 $lastUsedRow 행까지 있다 (행 잘림)"
  }

  $pages = $ws.PageSetup.Pages.Count
  if ($pages -gt 1) {
    # 다페이지면 반복 머리글이 반드시 있어야 한다. 없으면 2페이지부터 열 이름이 사라진다.
    if (-not $ws.PageSetup.PrintTitleRows) {
      Fail "$($ws.Name): $pages 페이지인데 반복 머리글이 없다"
    } else {
      Write-Output "  $($ws.Name): $pages 페이지, 반복 머리글 $($ws.PageSetup.PrintTitleRows)"
    }

    # 가로 페이지 나눔 — 열이 둘로 쪼개지면 인쇄물이 못 쓰게 된다
    $vBreaks = $ws.VPageBreaks.Count
    if ($vBreaks -gt 0) {
      Fail "$($ws.Name): 가로 페이지 나눔 $vBreaks 개 — 표가 좌우로 쪼개진다"
    }

    # 세로 페이지 나눔이 병합 셀 한가운데를 지나는지
    foreach ($hb in $ws.HPageBreaks) {
      $breakRow = $hb.Location.Row
      $cell = $ws.Cells.Item($breakRow, 1)
      if ($cell.MergeCells -and $cell.MergeArea.Row -lt $breakRow) {
        Fail "$($ws.Name): $breakRow 행의 페이지 나눔이 병합 셀을 가른다"
      }
    }
  }
}

# --- 편집 후 재계산 (설계서 §9.7, 인수 기준 A09) ---
# "Excel에서 다시 편집해도 수식이 작동해야 한다."
# 첫 내역 시트의 첫 품목 수량을 바꾸고, 갑지 최종 금액과 한글 금액이 따라 바뀌는지 본다.
$detail = $wb.Worksheets.Item(2)
$cover2 = $wb.Worksheets.Item(1)

# 갑지에서 최종 합계 행을 찾는다 (B열에 '최'로 시작하는 행).
$finalRow = 0
for ($r = 10; $r -le 40; $r++) {
  if ($cover2.Range("B$r").Text -like "*최*종*") { $finalRow = $r; break }
}
if ($finalRow -eq 0) { Fail "갑지에서 최종 합계 행을 찾지 못했다" }
else {
  # 첫 품목 행 = A열이 숫자 1인 행
  $itemRow = 0
  for ($r = 5; $r -le 60; $r++) {
    if ($detail.Range("A$r").Value2 -eq 1) { $itemRow = $r; break }
  }
  if ($itemRow -eq 0) { Fail "내역 시트에서 첫 품목 행을 찾지 못했다" }
  else {
    $beforeTotal = [double]$cover2.Range("H$finalRow").Value2
    $beforeText  = [string]$cover2.Range("C8").Text
    $beforeQty   = [double]$detail.Range("E$itemRow").Value2
    $unit        = [double]$detail.Range("F$itemRow").Value2

    $detail.Range("E$itemRow").Value2 = $beforeQty + 1
    $xl.CalculateFullRebuild()

    $afterTotal = [double]$cover2.Range("H$finalRow").Value2
    $afterText  = [string]$cover2.Range("C8").Text
    $rowAmount  = [double]$detail.Range("G$itemRow").Value2

    Write-Output ""
    Write-Output "편집 후 재계산 (수량 $beforeQty -> $($beforeQty + 1)):"
    Write-Output ("  행 금액 G{0} = {1}  (기대 {2})" -f $itemRow, $rowAmount, (($beforeQty + 1) * $unit))
    Write-Output ("  갑지 최종  = {0}  (편집 전 {1})" -f $afterTotal, $beforeTotal)

    if ($rowAmount -ne (($beforeQty + 1) * $unit)) {
      Fail "수량 수정 후 행 금액이 재계산되지 않았다"
    }
    if ($afterTotal -eq $beforeTotal) {
      Fail "수량 수정이 갑지 최종 금액에 반영되지 않았다"
    }
    if ($afterText -eq $beforeText) {
      Fail "수량 수정이 한글 금액 문구에 반영되지 않았다 (NUMBERSTRING 수식이 끊겼다)"
    } else {
      Write-Output ("  한글 금액  = {0}" -f $afterText)
    }
    if ($afterText -notmatch "V\.A\.T") {
      Fail "한글 금액 문구에 VAT 별도 표기가 없다"
    }
  }
}

$wb.Close($false)
$xl.Quit()

Write-Output ""
if ($failures.Count -gt 0) {
  Write-Output "=== 실패 $($failures.Count)건 ==="
  exit 1
}
Write-Output "=== 통과 ==="
exit 0
