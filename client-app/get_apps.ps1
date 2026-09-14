$results = @{}

function Clean-Path($path) {
    if (!$path) { return $null }
    return ($path -split ",")[0].Trim('"')
}

# Add error action preference
$ErrorActionPreference = 'SilentlyContinue'

# -------------------------
# 1️⃣ REGISTRY (Uninstall - Primary Source)
# -------------------------
$regPaths = @(
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

Write-Output "[Info] Scanning registry for installed applications..."

foreach ($path in $regPaths) {
  Get-ItemProperty $path -ErrorAction SilentlyContinue | ForEach-Object {

    if (!$_.DisplayName) { return }

    # ignore system components
    if ($_.SystemComponent -eq 1) { return }

    $launch = Clean-Path $_.DisplayIcon

    # fallback → InstallLocation
    if (-not $launch -and $_.InstallLocation) {
      $exe = Get-ChildItem $_.InstallLocation -Filter *.exe -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($exe) { $launch = $exe.FullName }
    }

    # Second fallback: try UninstallString
    if (-not $launch -and $_.UninstallString) {
      $uninstall = Clean-Path $_.UninstallString
      if (Test-Path $uninstall) { $launch = $uninstall }
    }

    # Include app even if no launch path found
    if (-not $results.ContainsKey($_.DisplayName)) {
      $results[$_.DisplayName] = [PSCustomObject]@{
        name    = $_.DisplayName
        version = $_.DisplayVersion
        launch  = if ($launch) { $launch } else { "" }
      }
    }
  }
}

Write-Output "[Info] Registry scan complete. Found $($results.Count) applications so far..."

# -------------------------
# 2️⃣ START MENU SHORTCUTS (Secondary Source)
# -------------------------
$startMenuPaths = @(
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
  "$env:AppData\Microsoft\Windows\Start Menu\Programs"
)

Write-Output "[Info] Scanning Start Menu for shortcuts..."

try {
  $wsh = New-Object -ComObject WScript.Shell
  
  foreach ($menu in $startMenuPaths) {
    Get-ChildItem $menu -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {

      $shortcut = $wsh.CreateShortcut($_.FullName)
      $name = $_.BaseName
      $target = $shortcut.TargetPath

      if ($target -and !$results.ContainsKey($name)) {
        $results[$name] = [PSCustomObject]@{
          name    = $name
          version = $null
          launch  = $target
        }
      }
    }
  }
} catch {
  Write-Output "[Warning] Error scanning Start Menu shortcuts"
}

Write-Output "[Info] Start Menu scan complete. Total applications found: $($results.Count)"

# -------------------------
# OUTPUT
# -------------------------
$json = $results.Values | Sort-Object name | ConvertTo-Json -Depth 3

if (-not $json) {
  $json = "[]"
}

<#
  Written under LOCALAPPDATA, not "output\apps.json" relative to this
  script's own folder. This script ships inside the client-app install,
  which — like volume.ps1 right beside it — is a per-machine NSIS install
  under Program Files: read-only to the standard, non-admin Windows account
  every station actually runs as. WriteAllText against a relative path
  there failed silently from the customer's side (main.js saw no output
  file appear and reported the scan as broken), which is exactly the
  regression this fixes. Same folder volume.ps1 already caches into, so
  there is one CafeXP-owned, always-writable folder per station instead of
  a second convention to remember.
#>
$outDir = Join-Path $env:LOCALAPPDATA 'CafeXP'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$outFile = Join-Path $outDir 'apps.json'

$utf8NoBOM = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($outFile, $json, $utf8NoBOM)

Write-Output "[Success] Exported $($results.Count) applications to $outFile"
