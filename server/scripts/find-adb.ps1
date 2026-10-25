# Locate adb.exe and print its path as Base64 (ASCII-safe to avoid encoding issues).
$p = (Get-CimInstance Win32_Process -Filter "Name='adb.exe'" -ErrorAction SilentlyContinue |
      Select-Object -First 1).ExecutablePath

if (-not $p) {
  $m = (Get-Process MuMuNxMain -ErrorAction SilentlyContinue | Select-Object -First 1).Path
  if ($m) {
    $cand = Join-Path (Split-Path $m) 'adb.exe'
    if (Test-Path $cand) { $p = $cand }
  }
}

if ($p) {
  [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p))
} else {
  Write-Output ''
}
