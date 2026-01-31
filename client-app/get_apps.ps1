$results = @{}

function Clean-Path($path) {
    if (!$path) { return $null }
    return ($path -split ",")[0].Trim('"')
}

# -------------------------
# 1️⃣ REGISTRY (Uninstall)
# -------------------------
$regPaths = @(
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
)

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

    if (-not $results.ContainsKey($_.DisplayName)) {
      $results[$_.DisplayName] = [PSCustomObject]@{
        name    = $_.DisplayName
        version = $_.DisplayVersion
        launch  = $launch
      }
    }
  }
}

# -------------------------
# 2️⃣ START MENU SHORTCUTS
# -------------------------
$startMenuPaths = @(
  "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
  "$env:AppData\Microsoft\Windows\Start Menu\Programs"
)

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

# -------------------------
# OUTPUT
# -------------------------
$json = $results.Values | Sort-Object name | ConvertTo-Json -Depth 3
$utf8NoBOM = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText("output\apps.json", $json, $utf8NoBOM)
