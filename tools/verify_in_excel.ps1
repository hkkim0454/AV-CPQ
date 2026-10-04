# 생성된 통합문서를 실제 Excel에서 열어 재계산·인쇄·수식 오류를 검증한다.
#
# 설계서 §9.7 / §11 단계 7: "Excel을 사용할 수 없으면 최종 Excel 검증을 통과했다고
# 보고하지 않는다." 이 스크립트가 그 검증이다. 브라우저 테스트로 대체하지 않는다.
#
# ## 사용자의 Excel을 건드리지 않는다 (계획 2026-10-04 Task 1)
#
# 이전 판은 시작하자마자 이것을 했다.
#
#     Get-Process EXCEL | ForEach-Object { $_.Kill() }
#
# 검증 한 번에 사용자가 열어 둔 **저장 안 한 통합문서가 전부 죽는다.** 경고도 없고
# 되돌릴 수도 없다. 제거했다. 이 스크립트는 자기가 만든 Application 하나만 책임지고,
# EXCEL 프로세스를 열거하거나 종료하지 않는다.
#
# 자기 것만 정리하려면 **중간에 무슨 일이 나도** 정리해야 한다. 그래서 전부
# try/finally 안에 있다. 이전 판은 try/finally가 없어서 중간 예외 하나로
# Excel이 통째로 남았다.
#
# ## 종료 코드
#
#     0  통과
#     1  검증 실패 — 산출물에 결함이 있다
#     2  미검증 — 입력 오류 또는 COM 불가. **통과가 아니다.**
#
# 설계서 §11: COM을 못 쓰면 "검증했다"가 아니라 "검증하지 못했다"로 보고한다.
# 호출부가 0과 2를 같게 다루면 검증 없이 출하된다.
#
# ## 사용
#
#     powershell -File tools\verify_in_excel.ps1 -Path <파일.xlsx>
#                [-Expected <기대값.json>] [-LayoutManifest <주소.json>]
#
# 기대값 JSON — 시트명 → 셀 주소 → 기대 문자열:
#   { "갑지": { "H13": "3580000" }, "교육장 영상": { "J28": "..." } }
#
# 주소 manifest — 편집 재계산이 어느 칸을 흔들지. **Task 5가 실제 주소로 만든다.**
# 없으면 평택 템플릿의 기존 가정(E수량·F단가·G금액)으로 되돌아간다.
#   {
#     "detailSheetIndex": 2,
#     "coverSheetIndex": 1,
#     "quantityColumn": "F", "unitPriceColumn": "G", "amountColumn": "H",
#     "coverAmountTextCell": "C8",
#     "directSubtotalLabelColumn": "A", "itemNumberColumn": "A"
#   }
#
# 민감 값을 출력하지 않는다 (설계서 §8.4). 좌표와 사유만 적는다. 금액은
# 기대값 대조에서만 나오며, 그 기대값은 호출부가 만든 합성 값이다.

param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Expected,
  [string]$LayoutManifest
)

$ErrorActionPreference = 'Stop'
$failures = New-Object System.Collections.ArrayList
$unverified = New-Object System.Collections.ArrayList

function Fail([string]$message) {
  [void]$failures.Add($message)
  Write-Output "  !! $message"
}

function Unverified([string]$message) {
  [void]$unverified.Add($message)
  Write-Output "  ?? 미검증: $message"
}

function Release($obj) {
  if ($null -eq $obj) { return }
  try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($obj) } catch { }
}

# ---------------------------------------------------------------------------
# 입력 검증 — COM을 만들기 **전에** 한다.
#
# Excel을 띄워 놓고 인자가 틀린 걸 발견하면, 정리 경로가 하나 더 늘고 그 경로가
# 제일 덜 밟히는 길이 된다. 덜 밟히는 정리 경로는 언젠가 샌다.
# ---------------------------------------------------------------------------

# 읽은 JSON은 $script:jsonResult 에 담는다. **반환하지 않는다.**
#
# PowerShell 함수는 `return` 값이 아니라 **출력 스트림 전체**를 돌려준다.
# 로그를 찍으면서 값을 return 하면 로그 문자열이 반환값에 섞인다.
# 실제로 이것 때문에 '파일 없음'이 $null 대신 안내 문자열로 반환됐고,
# 그 문자열의 .PSObject.Properties 가 시트 이름처럼 해석돼
# **입력 오류가 종료코드 2 가 아니라 "실패 9건"으로** 떨어졌다.
function Read-JsonFile([string]$label, [string]$file) {
  $script:jsonResult = $null
  if (-not (Test-Path -LiteralPath $file)) {
    Unverified "$label 파일이 없다: $file"
    return
  }
  if ((Get-Item -LiteralPath $file).PSIsContainer) {
    Unverified "$label 에 폴더가 왔다: $file"
    return
  }
  try {
    $script:jsonResult = (Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json)
  } catch {
    Unverified "$label JSON을 읽지 못했다: $file"
  }
}

if (-not (Test-Path -LiteralPath $Path)) {
  Write-Output "?? 미검증: 검증할 파일이 없다: $Path"
  exit 2
}
if ((Get-Item -LiteralPath $Path).PSIsContainer) {
  # 폴더를 넘기면 Workbooks.Open이 그 안을 뒤지거나 엉뚱하게 실패한다.
  Write-Output "?? 미검증: 파일이 아니라 폴더다: $Path"
  exit 2
}
if ([System.IO.Path]::GetExtension($Path) -ne '.xlsx') {
  Write-Output "?? 미검증: .xlsx 가 아니다: $Path"
  exit 2
}

$full = (Resolve-Path -LiteralPath $Path).Path

$expectedData = $null
if ($Expected) {
  Read-JsonFile '기대값' $Expected
  $expectedData = $script:jsonResult
  if ($null -eq $expectedData) {
    # 기대값을 **지정했는데** 못 읽었다. 조용히 건너뛰면 "대조했다"가 되어버린다.
    Write-Output "=== 미검증 $($unverified.Count)건 ==="
    exit 2
  }
}

$layout = $null
if ($LayoutManifest) {
  Read-JsonFile '주소 manifest' $LayoutManifest
  $layout = $script:jsonResult
  if ($null -eq $layout) {
    Write-Output "=== 미검증 $($unverified.Count)건 ==="
    exit 2
  }
}

function LayoutValue([string]$name, [string]$fallback) {
  if ($null -eq $layout) { return $fallback }
  $prop = $layout.PSObject.Properties[$name]
  if ($null -eq $prop) { return $fallback }
  if ($null -eq $prop.Value -or "$($prop.Value)" -eq '') { return $fallback }
  return "$($prop.Value)"
}

# 평택 템플릿의 기존 가정. manifest 가 오면 그쪽이 이긴다.
$colQty    = LayoutValue 'quantityColumn'    'E'
$colUnit   = LayoutValue 'unitPriceColumn'   'F'
$colAmount = LayoutValue 'amountColumn'      'G'
$cellText  = LayoutValue 'coverAmountTextCell' 'C8'
$idxDetail = [int](LayoutValue 'detailSheetIndex' '2')
$idxCover  = [int](LayoutValue 'coverSheetIndex'  '1')

Write-Output "## Excel 검증: $full"
if ($null -ne $layout) { Write-Output "주소 manifest 적용: $LayoutManifest" }
Write-Output "편집 재계산 기준 열: 수량=$colQty 단가=$colUnit 금액=$colAmount"

# ---------------------------------------------------------------------------
# COM — 여기부터는 무슨 일이 나도 finally 에서 자기 것만 정리한다.
# ---------------------------------------------------------------------------

$xl = $null
try {
  $xl = New-Object -ComObject Excel.Application
} catch {
  # Excel 이 없는 PC다. 실패가 아니라 **미검증**이다.
  Write-Output "?? 미검증: Excel COM 을 만들 수 없다 (Excel 미설치 또는 COM 불가)"
  exit 2
}

$wb = $null
try {
  $xl.DisplayAlerts = $false
  $xl.AskToUpdateLinks = $false
  $xl.Visible = $false
  # 사용자가 연 통합문서가 이 인스턴스에 딸려 오지 않게 한다.
  $xl.EnableEvents = $false

  try {
    # 복구 모드를 쓰지 않고 **읽기 전용**으로 연다. 손상이면 여기서 예외가 난다.
    # 읽기 전용이라 아래 편집 시험이 원본 파일에 저장될 수 없다.
    $wb = $xl.Workbooks.Open($full, 0, $true)
  } catch {
    Fail "열기 실패 (복구 경고 또는 손상)"
    # 예외 메시지에 경로·내용이 섞여 나올 수 있어 그대로 싣지 않는다.
    throw [System.Exception]::new('open-failed')
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
  #
  # SpecialCells 는 **해당 셀이 없으면 예외를 던진다.** 이전 판은 그 예외를
  # 전부 "오류 0개"로 삼켰다. COM 이 깨져서 못 센 것도 0개가 됐다.
  #
  # 그래서 먼저 UsedRange 를 건드려 이 시트에서 COM 이 동작하는지 확인한다.
  # 그게 되면 SpecialCells 의 예외는 "오류 셀 없음"이 맞다. 그게 안 되면
  # **못 센 것**이므로 미검증으로 올린다.
  $errorCount = 0
  foreach ($ws in $wb.Worksheets) {
    $probeOk = $false
    try {
      $null = $ws.UsedRange.Address()
      $probeOk = $true
    } catch {
      Unverified "수식 오류 검사를 수행하지 못했다: 시트 '$($ws.Name)'"
    }
    if (-not $probeOk) { continue }

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
      # 오류 셀이 하나도 없다 — UsedRange 가 동작했으므로 이것은 정상이다.
    }
  }
  Write-Output "수식 오류 셀: $errorCount"

  # --- 기대값 대조 ---
  if ($null -ne $expectedData) {
    $checked = 0
    foreach ($sheetName in $expectedData.PSObject.Properties.Name) {
      $ws = $null
      try { $ws = $wb.Worksheets.Item($sheetName) } catch { Fail "시트 없음: $sheetName"; continue }
      foreach ($cellRef in $expectedData.$sheetName.PSObject.Properties.Name) {
        $want = [string]$expectedData.$sheetName.$cellRef
        $got = $ws.Range($cellRef).Value2
        $gotText = if ($null -eq $got) { "" } elseif ($got -is [double]) { $got.ToString("R") } else { [string]$got }
        $checked++
        if ($gotText -ne $want) {
          Fail "$sheetName!$cellRef  기대=$want  Excel=$gotText"
        }
      }
    }
    Write-Output "대조한 셀: $checked"
    if ($checked -eq 0) {
      # 기대값 파일을 줬는데 한 셀도 대조하지 않았다. 빈 JSON 이거나 구조가 틀렸다.
      # 이것을 통과로 두면 "59셀 대조 통과"가 "0셀 대조 통과"로 조용히 바뀐다.
      Fail "기대값을 지정했는데 대조한 셀이 0개다"
    }
  }

  # --- 다페이지 인쇄 (설계서 §9.7, 인수 기준 A10, 열린 항목 O2a) ---
  foreach ($ws in $wb.Worksheets) {
    $area = $ws.PageSetup.PrintArea
    if (-not $area) { Fail "인쇄 영역이 없다: $($ws.Name)"; continue }

    # 인쇄 영역이 쓰인 범위를 전부 덮는가 — 행이 잘리면 여기서 걸린다.
    #
    # **열은 보지 않는다.** 품셈 블록과 BF 메모는 인쇄 영역 밖에 있는 것이
    # 의도다 (D18). 열까지 덮으라고 하면 그 설계가 결함으로 잡힌다.
    #
    # **서식만 있는 행도 세지 않는다.** UsedRange 는 테두리만 그어 둔 빈 행까지
    # 포함한다. 가이드 갑지가 그래서 22행까지 '쓰인' 것으로 잡혔는데, 실제
    # 내용은 19행에서 끝난다. 값이 있는 칸만 본다.
    $areaRange = $ws.Range($area)
    $lastAreaRow = $areaRange.Row + $areaRange.Rows.Count - 1
    $lastAreaCol = $areaRange.Column + $areaRange.Columns.Count - 1
    $lastUsedRow = $ws.UsedRange.Row + $ws.UsedRange.Rows.Count - 1

    $spill = 0
    for ($r = $lastAreaRow + 1; $r -le $lastUsedRow; $r++) {
      for ($c = $areaRange.Column; $c -le $lastAreaCol; $c++) {
        $cellValue = $ws.Cells.Item($r, $c).Value2
        if ($null -ne $cellValue -and "$cellValue" -ne '') { $spill = $r; break }
      }
      if ($spill -gt 0) { break }
    }
    if ($spill -gt 0) {
      Fail "$($ws.Name): 인쇄 영역이 $lastAreaRow 행까지인데 $spill 행에 값이 있다 (행 잘림)"
    }

    $pages = $ws.PageSetup.Pages.Count
    if ($pages -gt 1) {
      if (-not $ws.PageSetup.PrintTitleRows) {
        Fail "$($ws.Name): $pages 페이지인데 반복 머리글이 없다"
      } else {
        Write-Output "  $($ws.Name): $pages 페이지, 반복 머리글 $($ws.PageSetup.PrintTitleRows)"
      }

      $vBreaks = $ws.VPageBreaks.Count
      if ($vBreaks -gt 0) {
        Fail "$($ws.Name): 가로 페이지 나눔 $vBreaks 개 — 표가 좌우로 쪼개진다"
      }

      foreach ($hb in $ws.HPageBreaks) {
        $breakRow = $hb.Location.Row
        $cell = $ws.Cells.Item($breakRow, 1)
        if ($cell.MergeCells -and $cell.MergeArea.Row -lt $breakRow) {
          Fail "$($ws.Name): $breakRow 행의 페이지 나눔이 병합 셀을 가른다"
        }
      }
    }
  }

  # --- 행 잘림 측정 (인수 기준 A10) ---
  # 고정 행 높이 때문에 내용이 잘리는지 본다. 읽기 전용으로 열었고 Close($false)
  # 하므로 AutoFit 은 메모리에서만 일어난다.
  #
  # **내역 시트만 본다.** 갑지는 길이가 고정된 양식 문구뿐이고 원본 견적서도
  # 똑같이 AutoFit 기준을 넘는다 (실측: 원본 갑지 8행 24->26.5). 회사 양식의
  # 설계이지 생성기의 결함이 아니다. 내역 시트는 반복 머리글로 식별한다.
  foreach ($ws in $wb.Worksheets) {
    $area = $ws.PageSetup.PrintArea
    if (-not $area) { continue }
    if (-not $ws.PageSetup.PrintTitleRows) {
      Write-Output "  $($ws.Name): 행 잘림 검사 제외 (양식 고정 시트)"
      continue
    }
    $areaRange = $ws.Range($area)
    $firstRow = $areaRange.Row
    $lastRow = $areaRange.Row + $areaRange.Rows.Count - 1

    $clipped = 0
    $samples = @()
    for ($r = $firstRow; $r -le $lastRow; $r++) {
      $rowObj = $ws.Rows.Item($r)
      # 병합 셀이 있는 행은 AutoFit 결과를 믿을 수 없다 — 건너뛴다
      if ($ws.Cells.Item($r, 1).MergeCells -or $ws.Cells.Item($r, 2).MergeCells) { continue }
      $before = [double]$rowObj.RowHeight
      $rowObj.AutoFit() | Out-Null
      $after = [double]$rowObj.RowHeight
      if ($after -gt $before + 0.6) {
        $clipped++
        if ($samples.Count -lt 5) {
          $samples += ("{0}행 (높이 {1} -> {2}) B='{3}'" -f $r, $before, $after, $ws.Cells.Item($r, 2).Text)
        }
      }
      $rowObj.RowHeight = $before
    }
    if ($clipped -gt 0) {
      Fail "$($ws.Name): 고정 행 높이로 잘리는 행 $clipped 개"
      foreach ($smp in $samples) { Write-Output "      $smp" }
    } else {
      Write-Output "  $($ws.Name): 행 잘림 없음"
    }
  }

  # --- 편집 후 재계산 (설계서 §9.7, 인수 기준 A09) ---
  # "Excel에서 다시 편집해도 수식이 작동해야 한다."
  # 내역 시트의 첫 품목 수량을 바꾸고, 갑지 최종 금액과 한글 금액이 따라 바뀌는지 본다.
  if ($wb.Worksheets.Count -lt [Math]::Max($idxDetail, $idxCover)) {
    Unverified "편집 재계산: 시트가 $($wb.Worksheets.Count)장이라 지정한 색인($idxDetail/$idxCover)을 쓸 수 없다"
  } else {
    $detail = $wb.Worksheets.Item($idxDetail)
    $cover2 = $wb.Worksheets.Item($idxCover)

    # 갑지의 합계 행을 찾는다.
    #
    # 양식마다 이름이 다르다. 평택 원본은 '최종 금액', 가이드는 '합     계' 다.
    # 하나만 찾으면 다른 양식에서 "찾지 못했다"가 난다.
    $finalRow = [int](LayoutValue 'coverTotalRow' '0')
    if ($finalRow -eq 0) {
      for ($r = 10; $r -le 40; $r++) {
        $label = $cover2.Range("B$r").Text
        if ($label -like "*최*종*" -or $label -like "*합*계*") { $finalRow = $r; break }
      }
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
        $beforeText  = [string]$cover2.Range($cellText).Text
        $beforeQty   = [double]$detail.Range("$colQty$itemRow").Value2
        $unit        = [double]$detail.Range("$colUnit$itemRow").Value2

        # 갑지 합계는 만원 미만을 절사한다. 수량을 1만 올리면 변화가 절사에 먹혀
        # "반영되지 않았다"는 거짓 실패가 난다. 절사 단위를 확실히 넘기도록 흔든다.
        $delta = 1000
        $detail.Range("$colQty$itemRow").Value2 = $beforeQty + $delta
        $xl.CalculateFullRebuild()

        $afterTotal = [double]$cover2.Range("H$finalRow").Value2
        $afterText  = [string]$cover2.Range($cellText).Text
        $rowAmount  = [double]$detail.Range("$colAmount$itemRow").Value2

        # 직접비계는 절사가 없다. 여기가 안 움직이면 수식 연쇄 자체가 끊긴 것이다.
        $directRow = 0
        for ($r = 5; $r -le 400; $r++) {
          if ($detail.Range("A$r").Text -like "*직접비계*") { $directRow = $r; break }
        }
        if ($directRow -gt 0) {
          $afterDirect = [double]$detail.Range("$colAmount$directRow").Value2
          Write-Output ("  직접비계 {0}{1} = {2}" -f $colAmount, $directRow, $afterDirect)
          if ($afterDirect -le 0) { Fail "직접비계가 0 이하다" }
        }

        Write-Output ""
        Write-Output "편집 후 재계산 (수량 $beforeQty -> $($beforeQty + $delta)):"
        Write-Output ("  행 금액 {0}{1} = {2}  (기대 {3})" -f $colAmount, $itemRow, $rowAmount, (($beforeQty + $delta) * $unit))
        Write-Output ("  갑지 최종  = {0}  (편집 전 {1})" -f $afterTotal, $beforeTotal)

        if ($rowAmount -ne (($beforeQty + $delta) * $unit)) {
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
  }
} catch {
  if ("$($_.Exception.Message)" -ne 'open-failed') {
    # 검증 도중 터진 예외를 "오류 0개"로 흘려보내지 않는다.
    Fail "검증 도중 예외가 발생했다: $($_.Exception.GetType().Name)"
  }
} finally {
  # 자기가 연 통합문서와 자기 Application 만 정리한다.
  # 사용자가 열어 둔 창은 다른 인스턴스이므로 영향받지 않는다.
  if ($null -ne $wb) {
    try { $wb.Close($false) } catch { }   # $false = 저장하지 않는다
    Release $wb
  }
  if ($null -ne $xl) {
    try { $xl.Quit() } catch { }
    Release $xl
  }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}

Write-Output ""
if ($failures.Count -gt 0) {
  Write-Output "=== 실패 $($failures.Count)건 ==="
  if ($unverified.Count -gt 0) { Write-Output "=== 미검증 $($unverified.Count)건 ===" }
  exit 1
}
if ($unverified.Count -gt 0) {
  # 실패는 없지만 전부 확인하지는 못했다. **통과가 아니다.**
  Write-Output "=== 미검증 $($unverified.Count)건 — 통과로 보고하지 않는다 ==="
  exit 2
}
Write-Output "=== 통과 ==="
exit 0
