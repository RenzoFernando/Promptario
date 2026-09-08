param(
  [ValidateSet("menu", "init", "deploy", "status", "lock", "unlock", "change-pin", "block", "unblock", "events", "email")]
  [string]$Action = "menu"
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$configPath = Join-Path $PSScriptRoot ".promptario-admin.json"
$deployConfigPath = Join-Path $PSScriptRoot ".promptario-wrangler.json"
$schemaPath = Join-Path $PSScriptRoot "cloudflare\schema.sql"
$script:DatabaseName = ""
$script:DatabaseId = ""
$script:WorkerName = ""
$script:WorkerUrl = ""

function Invoke-Wrangler {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  & npx --yes wrangler @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "Wrangler termino con codigo $LASTEXITCODE."
  }
}

function Ensure-CloudflareLogin {
  if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    throw "No se encontro npx. Instala Node.js antes de ejecutar este administrador."
  }

  & npx --yes wrangler whoami *> $null

  if ($LASTEXITCODE -ne 0) {
    Invoke-Wrangler login
  }
}

function Read-Config {
  if (-not (Test-Path $configPath)) {
    return $null
  }

  try {
    return Get-Content $configPath -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Save-Config {
  $payload = [ordered]@{
    databaseName = $script:DatabaseName
    databaseId = $script:DatabaseId
    workerName = $script:WorkerName
    workerUrl = $script:WorkerUrl
  }
  $payload | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
}

function Select-Database {
  $config = Read-Config
  $raw = (& npx --yes wrangler d1 list --json 2>$null | Out-String)

  if ($LASTEXITCODE -ne 0 -or -not $raw.Trim()) {
    throw "No fue posible listar las bases D1."
  }

  $parsed = $raw | ConvertFrom-Json
  $databases = if ($parsed -is [System.Array]) { @($parsed) } elseif ($parsed.result) { @($parsed.result) } else { @($parsed) }

  if ($config -and $config.databaseName) {
    $saved = @($databases | Where-Object { $_.name -eq $config.databaseName })

    if ($saved.Count -eq 1) {
      $script:DatabaseName = [string]$saved[0].name
      $script:DatabaseId = [string]$saved[0].uuid
      $script:WorkerName = [string]$config.workerName
      $script:WorkerUrl = [string]$config.workerUrl
      Save-Config
      return
    }
  }

  $promptarioDatabases = @($databases | Where-Object { $_.name -match "promptario" })

  if ($promptarioDatabases.Count -eq 1) {
    $script:DatabaseName = [string]$promptarioDatabases[0].name
    $script:DatabaseId = [string]$promptarioDatabases[0].uuid
    Save-Config
    return
  }

  if ($databases.Count -eq 1) {
    $script:DatabaseName = [string]$databases[0].name
    $script:DatabaseId = [string]$databases[0].uuid
    Save-Config
    return
  }

  if ($databases.Count -eq 0) {
    throw "La cuenta no tiene bases D1."
  }

  Write-Host "Bases D1 disponibles:"

  for ($index = 0; $index -lt $databases.Count; $index += 1) {
    Write-Host "[$($index + 1)] $($databases[$index].name)"
  }

  $selection = [int](Read-Host "Selecciona la base de Promptario")

  if ($selection -lt 1 -or $selection -gt $databases.Count) {
    throw "Seleccion invalida."
  }

  $script:DatabaseName = [string]$databases[$selection - 1].name
  $script:DatabaseId = [string]$databases[$selection - 1].uuid
  Save-Config
}

function Ensure-WorkerName {
  $config = Read-Config

  if (-not $script:WorkerName -and $config -and $config.workerName) {
    $script:WorkerName = [string]$config.workerName
  }

  if (-not $script:WorkerUrl -and $config -and $config.workerUrl) {
    $script:WorkerUrl = [string]$config.workerUrl
  }

  if (-not $script:WorkerUrl -or -not $script:WorkerName) {
    try {
      $securityConfigUrl = "https://firestore.googleapis.com/v1/projects/promptario-58cd3/databases/(default)/documents/publicConfig/security"
      $document = Invoke-RestMethod -Uri $securityConfigUrl -Method Get
      $workerUrl = [string]$document.fields.workerUrl.stringValue

      if ($workerUrl) {
        $script:WorkerUrl = $workerUrl.TrimEnd("/")
        $uri = [Uri]$script:WorkerUrl

        if ($uri.Host -match "^([^.]+)\.[^.]+\.workers\.dev$") {
          $script:WorkerName = $Matches[1]
        }
      }
    } catch {
    }
  }

  if (-not $script:WorkerName) {
    $script:WorkerName = (Read-Host "Nombre del Worker de Promptario").Trim()
  }

  if (-not $script:WorkerName) {
    throw "El nombre del Worker es obligatorio."
  }

  if (-not $script:WorkerUrl) {
    $script:WorkerUrl = (Read-Host "URL HTTPS del Worker de Promptario").Trim().TrimEnd("/")
  }

  $parsedWorkerUrl = $null

  if (-not [Uri]::TryCreate($script:WorkerUrl, [UriKind]::Absolute, [ref]$parsedWorkerUrl) -or $parsedWorkerUrl.Scheme -ne "https") {
    throw "La URL del Worker debe ser HTTPS."
  }

  Save-Config
}

function Invoke-D1Command {
  param([string]$Sql)
  Invoke-Wrangler d1 execute $script:DatabaseName --remote --command $Sql --yes
}

function Invoke-D1File {
  param([string]$Path)
  Invoke-Wrangler d1 execute $script:DatabaseName --remote --file $Path --yes
}

function Read-SecretText {
  param([string]$Prompt)

  $secure = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)

  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

function Convert-Base64Url {
  param([byte[]]$Bytes)
  return [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function New-RandomToken {
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()

  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }

  return Convert-Base64Url $bytes
}

function Set-WorkerSecretsBulk {
  param([System.Collections.IDictionary]$Values)

  Ensure-WorkerName
  $json = $Values | ConvertTo-Json -Compress
  $json | & npx --yes wrangler secret bulk --name $script:WorkerName

  if ($LASTEXITCODE -ne 0) {
    throw "No fue posible actualizar los secrets del Worker."
  }
}

function Escape-SqlValue {
  param([string]$Value)
  return $Value.Replace("'", "''")
}

function Initialize-SecuritySchema {
  Invoke-D1File $schemaPath
}


function Deploy-Worker {
  Ensure-WorkerName

  if (-not $script:DatabaseId) {
    throw "No fue posible obtener el identificador de la base D1."
  }

  Initialize-SecuritySchema

  $config = [ordered]@{
    name = $script:WorkerName
    main = "cloudflare/src/index.js"
    compatibility_date = (Get-Date).ToString("yyyy-MM-dd")
    workers_dev = $true
    vars = [ordered]@{
      ALLOWED_ORIGIN = "https://renzofernando.github.io"
      FIREBASE_PROJECT_ID = "promptario-58cd3"
      PUBLIC_APP_URL = "https://renzofernando.github.io/Promptario/"
    }
    d1_databases = @(
      [ordered]@{
        binding = "DB"
        database_name = $script:DatabaseName
        database_id = $script:DatabaseId
      }
    )
  }

  $config | ConvertTo-Json -Depth 6 | Set-Content $deployConfigPath -Encoding UTF8

  try {
    Invoke-Wrangler deploy --config $deployConfigPath
  } finally {
    Remove-Item $deployConfigPath -Force -ErrorAction SilentlyContinue
  }
}

function Show-Status {
  Invoke-D1Command "SELECT failed_attempts, locked, locked_at, last_failed_at, last_success_at, updated_at FROM security_state WHERE id = 1; SELECT version, updated_at FROM session_state WHERE id = 1; SELECT target, kind, created_at, note FROM blocked_clients ORDER BY id DESC;"
}

function Set-ManualLock {
  $sql = "UPDATE security_state SET failed_attempts = 5, locked = 1, lock_event_recorded = 1, locked_at = datetime('now'), updated_at = datetime('now') WHERE id = 1; UPDATE session_state SET version = version + 1, updated_at = datetime('now') WHERE id = 1; INSERT INTO security_events (type, created_at, details) VALUES ('manual-lock', datetime('now'), 'powershell-admin');"
  Invoke-D1Command $sql
}

function Set-ManualUnlock {
  $sql = "UPDATE security_state SET failed_attempts = 0, locked = 0, lock_event_recorded = 0, locked_at = NULL, updated_at = datetime('now') WHERE id = 1; UPDATE session_state SET version = version + 1, updated_at = datetime('now') WHERE id = 1; UPDATE recovery_tokens SET used_at = COALESCE(used_at, datetime('now')) WHERE used_at IS NULL; INSERT INTO security_events (type, created_at, details) VALUES ('manual-unlock', datetime('now'), 'powershell-admin');"
  Invoke-D1Command $sql
}

function Set-NewPin {
  Ensure-WorkerName
  Initialize-SecuritySchema
  $pin = Read-SecretText "Nuevo PIN de 4 digitos"
  $confirmation = Read-SecretText "Confirma el PIN"

  if ($pin -notmatch "^\d{4}$") {
    throw "El PIN debe tener exactamente 4 digitos."
  }

  if ($pin -ne $confirmation) {
    throw "Los PIN no coinciden."
  }

  $adminToken = New-RandomToken
  $pinUpdated = $false
  Set-WorkerSecretsBulk ([ordered]@{ ADMIN_CLI_TOKEN = $adminToken })

  try {
    $headers = @{ Authorization = "Bearer $adminToken" }
    $body = @{ pin = $pin; confirmation = $confirmation } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Uri "$($script:WorkerUrl)/admin/change-pin" -Method Post -Headers $headers -ContentType "application/json" -Body $body

    if (-not $result.ok -or $result.status -ne "updated") {
      throw "El Worker no confirmo el cambio de PIN."
    }

    $pinUpdated = $true
  } finally {
    try {
      $cleanup = [ordered]@{ ADMIN_CLI_TOKEN = $null }

      if ($pinUpdated) {
        $cleanup.PROMPTARIO_PIN = $null
      }

      Set-WorkerSecretsBulk $cleanup
    } catch {
      Write-Warning "No fue posible retirar los secrets temporales o heredados. Revisalos en Cloudflare antes de continuar."
    }
  }
}

function Add-BlockedClient {
  $target = (Read-Host "IP exacta o red IPv4 CIDR, por ejemplo 203.0.113.0/24").Trim()

  if (-not $target) {
    throw "Debes indicar una IP o red."
  }

  $kind = if ($target.Contains("/")) { "cidr" } else { "ip" }
  $address = $null

  if ($kind -eq "cidr") {
    $parts = $target.Split("/")
    $prefix = if ($parts.Count -eq 2 -and $parts[1] -match "^\d{1,2}$") { [int]$parts[1] } else { -1 }

    if ($parts.Count -ne 2 -or $prefix -lt 0 -or $prefix -gt 32 -or -not [Net.IPAddress]::TryParse($parts[0], [ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
      throw "La red CIDR no es valida."
    }
  } elseif (-not [Net.IPAddress]::TryParse($target, [ref]$address)) {
    throw "La IP no es valida."
  }

  $escapedTarget = Escape-SqlValue $target
  $sql = "INSERT OR IGNORE INTO blocked_clients (target, kind, created_at, note) VALUES ('$escapedTarget', '$kind', datetime('now'), 'powershell-admin'); INSERT INTO security_events (type, created_at, details) VALUES ('client-blocked-manually', datetime('now'), '$escapedTarget');"
  Invoke-D1Command $sql
}

function Remove-BlockedClient {
  $target = (Read-Host "IP o red CIDR que quieres desbloquear").Trim()

  if (-not $target) {
    throw "Debes indicar una IP o red."
  }

  $escapedTarget = Escape-SqlValue $target
  $sql = "DELETE FROM blocked_clients WHERE target = '$escapedTarget'; INSERT INTO security_events (type, created_at, details) VALUES ('client-unblocked-manually', datetime('now'), '$escapedTarget');"
  Invoke-D1Command $sql
}

function Show-Events {
  Invoke-D1Command "SELECT id, type, created_at, details FROM security_events ORDER BY id DESC LIMIT 50;"
}

function Configure-RecoveryEmail {
  Ensure-WorkerName
  $apiKey = Read-SecretText "API key de Resend"
  $email = Read-SecretText "Correo personal de recuperacion"

  if (-not $apiKey) {
    throw "La API key de Resend es obligatoria."
  }

  try {
    $parsedEmail = [Net.Mail.MailAddress]::new($email)
  } catch {
    throw "El correo de recuperacion no es valido."
  }

  if ($parsedEmail.Address -ne $email) {
    throw "El correo de recuperacion no es valido."
  }

  Set-WorkerSecretsBulk ([ordered]@{
    RESEND_API_KEY = $apiKey
    RECOVERY_EMAIL = $email
  })
}

function Invoke-Action {
  param([string]$SelectedAction)

  switch ($SelectedAction) {
    "init" { Initialize-SecuritySchema }
    "deploy" { Deploy-Worker }
    "status" { Initialize-SecuritySchema; Show-Status }
    "lock" { Initialize-SecuritySchema; Set-ManualLock }
    "unlock" { Initialize-SecuritySchema; Set-ManualUnlock }
    "change-pin" { Set-NewPin }
    "block" { Initialize-SecuritySchema; Add-BlockedClient }
    "unblock" { Initialize-SecuritySchema; Remove-BlockedClient }
    "events" { Initialize-SecuritySchema; Show-Events }
    "email" { Configure-RecoveryEmail }
  }
}

Ensure-CloudflareLogin
Select-Database

if ($Action -ne "menu") {
  Invoke-Action $Action
  exit 0
}

do {
  Write-Host ""
  Write-Host "Promptario - administracion"
  Write-Host "D1: $script:DatabaseName"
  Write-Host "[1] Inicializar o actualizar esquema"
  Write-Host "[2] Desplegar Worker y actualizar esquema"
  Write-Host "[3] Ver estado"
  Write-Host "[4] Bloquear edicion"
  Write-Host "[5] Desbloquear edicion"
  Write-Host "[6] Cambiar PIN"
  Write-Host "[7] Bloquear IP o red"
  Write-Host "[8] Desbloquear IP o red"
  Write-Host "[9] Ver eventos"
  Write-Host "[10] Configurar correo de recuperacion"
  Write-Host "[0] Salir"
  $choice = Read-Host "Opcion"

  switch ($choice) {
    "1" { Invoke-Action "init" }
    "2" { Invoke-Action "deploy" }
    "3" { Invoke-Action "status" }
    "4" { Invoke-Action "lock" }
    "5" { Invoke-Action "unlock" }
    "6" { Invoke-Action "change-pin" }
    "7" { Invoke-Action "block" }
    "8" { Invoke-Action "unblock" }
    "9" { Invoke-Action "events" }
    "10" { Invoke-Action "email" }
    "0" { return }
    default { Write-Host "Opcion invalida." }
  }
} while ($true)
