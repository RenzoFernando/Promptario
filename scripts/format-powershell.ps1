$ErrorActionPreference = "Stop"

if (-not (Get-Module -ListAvailable -Name PSScriptAnalyzer)) {
  throw "Instala PSScriptAnalyzer con: Install-Module PSScriptAnalyzer -Scope CurrentUser"
}

Import-Module PSScriptAnalyzer
$projectRoot = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $projectRoot "promptario-admin.ps1"
$source = Get-Content -LiteralPath $scriptPath -Raw -Encoding UTF8
$formatted = Invoke-Formatter -ScriptDefinition $source

if ($formatted -ne $source) {
  [System.IO.File]::WriteAllText($scriptPath, $formatted, [System.Text.UTF8Encoding]::new($false))
  Write-Host "Formato actualizado: promptario-admin.ps1"
} else {
  Write-Host "Sin cambios: promptario-admin.ps1"
}
