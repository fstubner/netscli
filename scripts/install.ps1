# NetsCLI Installer for Windows
#
# Usage:
#   iwr -useb https://raw.githubusercontent.com/fstubner/netscli/main/scripts/install.ps1 | iex
#
# Optional environment variables:
#   - INSTALL_DIR: Where to place netscli.exe (default: $env:USERPROFILE\.cargo\bin)
#   - REPO:        GitHub repo, like "owner/name" (default: "fstubner/netscli")
#   - NETSCLI_VERSION: Release tag to install (e.g. "v0.1.0"); defaults to latest
#   - NETSCLI_PCAP=1: install the PCAP-enabled binary AND run the Npcap installer
#                    (admin required for the Npcap step)
#   - NETSCLI_SKIP_NPCAP=1: with NETSCLI_PCAP=1, skip the Npcap installer
#                          (for users who already have Npcap installed)
#   - NETSCLI_NPCAP_URL: Override the Npcap installer URL

$ErrorActionPreference = "Stop"

$INSTALL_DIR = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { "$env:USERPROFILE\.cargo\bin" }
$BINARY_NAME = "netscli.exe"
$REPO = if ($env:REPO) { $env:REPO } else { "fstubner/netscli" }
$NETSCLI_VERSION = if ($env:NETSCLI_VERSION) { $env:NETSCLI_VERSION } else { "" }
$NETSCLI_SHA256 = if ($env:NETSCLI_SHA256) { $env:NETSCLI_SHA256 } else { "" }
$NETSCLI_SHA256_URL = if ($env:NETSCLI_SHA256_URL) { $env:NETSCLI_SHA256_URL } else { "" }
$NETSCLI_PCAP = if ($env:NETSCLI_PCAP) { $env:NETSCLI_PCAP } else { "" }
$NETSCLI_SKIP_NPCAP = if ($env:NETSCLI_SKIP_NPCAP) { $env:NETSCLI_SKIP_NPCAP } else { "" }

# Backwards-compat: older docs used NETSCLI_INSTALL_NPCAP as a separate toggle.
# If the user set it, fold it into NETSCLI_PCAP so the old invocation works.
if (-not $NETSCLI_PCAP -and $env:NETSCLI_INSTALL_NPCAP) {
    $NETSCLI_PCAP = $env:NETSCLI_INSTALL_NPCAP
}

$NETSCLI_NPCAP_URL = if ($env:NETSCLI_NPCAP_URL) { $env:NETSCLI_NPCAP_URL } else { "https://npcap.com/dist/npcap-1.80.exe" }

Write-Host "NetsCLI Installer" -ForegroundColor Cyan
Write-Host "=================" -ForegroundColor Cyan
Write-Host ""

# Ensure TLS 1.2 for older Windows PowerShell
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
  # ignore
}

function Test-True([string]$value) {
  if (-not $value) { return $false }
  switch ($value.ToLowerInvariant()) {
    "1" { return $true }
    "true" { return $true }
    "yes" { return $true }
    "y" { return $true }
    default { return $false }
  }
}

function Test-NpcapInstalled {
  $paths = @(
    "C:\Windows\System32\Npcap\wpcap.dll",
    "C:\Windows\System32\wpcap.dll"
  )
  foreach ($p in $paths) {
    if (Test-Path $p) { return $true }
  }
  return $false
}

function Install-Npcap([string]$downloadDir, [string]$url) {
  $npcapExe = Join-Path $downloadDir "npcap-installer.exe"
  Write-Host "Downloading Npcap from: $url" -ForegroundColor Cyan
  Invoke-WebRequest -Uri $url -OutFile $npcapExe
  if (-not (Test-Path $npcapExe)) {
    Write-Host "Npcap download failed." -ForegroundColor Red
    return $false
  }

  Write-Host "Launching Npcap installer (admin required)..." -ForegroundColor Cyan
  $proc = Start-Process -FilePath $npcapExe -Wait -PassThru
  return $proc.ExitCode -eq 0
}

$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -ne "AMD64") {
  Write-Host "Unsupported architecture: $arch (expected AMD64)." -ForegroundColor Red
  exit 1
}

$ENABLE_PCAP = Test-True $NETSCLI_PCAP
# `NETSCLI_PCAP=1` is the one user-facing knob; it both selects the pcap
# binary variant AND triggers Npcap installation. `NETSCLI_SKIP_NPCAP=1`
# lets users opt out of the Npcap step (e.g., Npcap already installed).
$SKIP_NPCAP = Test-True $NETSCLI_SKIP_NPCAP

$ASSET_NAME = if ($ENABLE_PCAP) { "netscli-windows-x86_64-pcap.exe" } else { "netscli-windows-x86_64.exe" }

$DOWNLOAD_BASE = "https://github.com/$REPO/releases"
if ($NETSCLI_VERSION -and $NETSCLI_VERSION.Trim().Length -gt 0) {
  $DOWNLOAD_URL = "$DOWNLOAD_BASE/download/$NETSCLI_VERSION/$ASSET_NAME"
} else {
  $DOWNLOAD_URL = "$DOWNLOAD_BASE/latest/download/$ASSET_NAME"
}

$tmpDir = Join-Path $env:TEMP ("netscli-install-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

try {
  $tmpExe = Join-Path $tmpDir $BINARY_NAME

  Write-Host "Downloading release asset:" -ForegroundColor Cyan
  Write-Host "  $DOWNLOAD_URL" -ForegroundColor DarkGray

  try {
    Invoke-WebRequest -Uri $DOWNLOAD_URL -OutFile $tmpExe
  } catch {
    Write-Host "Download failed." -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "URL: $DOWNLOAD_URL" -ForegroundColor Yellow
    exit 1
  }

  if (-not (Test-Path $tmpExe)) {
    Write-Host "Download failed: $tmpExe not found." -ForegroundColor Red
    exit 1
  }

  if ($NETSCLI_SHA256_URL -and $NETSCLI_SHA256_URL.Trim().Length -gt 0) {
    Write-Host "Fetching checksum from: $NETSCLI_SHA256_URL" -ForegroundColor Cyan
    $checksumResponse = Invoke-WebRequest -Uri $NETSCLI_SHA256_URL
    $NETSCLI_SHA256 = ($checksumResponse.Content -split '\s+')[0]
  } elseif (-not $NETSCLI_SHA256 -or $NETSCLI_SHA256.Trim().Length -eq 0) {
    # Best-effort: if the release publishes "<asset>.sha256", use it automatically.
    $autoChecksumUrl = "$DOWNLOAD_URL.sha256"
    try {
      $checksumResponse = Invoke-WebRequest -Uri $autoChecksumUrl
      $NETSCLI_SHA256 = ($checksumResponse.Content -split '\s+')[0]
    } catch {
      # ignore (asset not published or unreachable)
    }
  }

  if ($NETSCLI_SHA256 -and $NETSCLI_SHA256.Trim().Length -gt 0) {
    Write-Host "Verifying checksum..." -ForegroundColor Cyan
    $hash = (Get-FileHash -Algorithm SHA256 -Path $tmpExe).Hash.ToLower()
    if ($hash -ne $NETSCLI_SHA256.Trim().ToLower()) {
      Write-Host "Checksum mismatch. Expected $NETSCLI_SHA256, got $hash" -ForegroundColor Red
      exit 1
    }
  } else {
    Write-Host "Warning: no checksum verification performed (set NETSCLI_SHA256 or NETSCLI_SHA256_URL)." -ForegroundColor Yellow
  }

  if (-not (Test-Path $INSTALL_DIR)) {
    New-Item -ItemType Directory -Path $INSTALL_DIR -Force | Out-Null
  }

  Copy-Item $tmpExe (Join-Path $INSTALL_DIR $BINARY_NAME) -Force

  Write-Host ""
  Write-Host "Installed successfully." -ForegroundColor Green
  Write-Host "Location: $INSTALL_DIR\$BINARY_NAME" -ForegroundColor Green

  $pathParts = $env:PATH -split ';'
  $inPath = $false
  foreach ($p in $pathParts) {
    if ($p.TrimEnd('\\') -ieq $INSTALL_DIR.TrimEnd('\\')) { $inPath = $true }
  }

  if (-not $inPath) {
    Write-Host ""
    Write-Host "NOTE: $INSTALL_DIR is not in your PATH." -ForegroundColor Yellow
    Write-Host "Add it via Windows Settings -> Environment Variables, or run:" -ForegroundColor Yellow
    Write-Host "  setx PATH `"$env:PATH;$INSTALL_DIR`"" -ForegroundColor Yellow
  }

  if ($ENABLE_PCAP) {
    if (Test-NpcapInstalled) {
      Write-Host ""
      Write-Host "Npcap detected — no install needed." -ForegroundColor Green
    } elseif ($SKIP_NPCAP) {
      Write-Host ""
      Write-Host "Npcap not detected; skipping install as requested (NETSCLI_SKIP_NPCAP=1)." -ForegroundColor Yellow
    } else {
      Write-Host ""
      Write-Host "Npcap not detected. Installing..." -ForegroundColor Yellow
      $ok = Install-Npcap -downloadDir $tmpDir -url $NETSCLI_NPCAP_URL
      if ($ok) {
        Write-Host "Npcap installation completed." -ForegroundColor Green
      } else {
        Write-Host "Npcap installation failed or was cancelled." -ForegroundColor Red
        Write-Host "Install manually from https://npcap.com/#download (pick WinPcap-compatible mode)." -ForegroundColor Yellow
      }
    }
  }

  Write-Host ""
  Write-Host "Try: netscli --help" -ForegroundColor Green
  if (-not $ENABLE_PCAP) {
    Write-Host ""
    Write-Host "PCAP support is not installed in this build." -ForegroundColor DarkGray
    Write-Host "To add packet capture, re-run with NETSCLI_PCAP=1 (admin required for Npcap)." -ForegroundColor DarkGray
  }
  Write-Host "- Ensure wpcap.dll is on PATH (for example C:\\Windows\\System32\\Npcap)." -ForegroundColor DarkGray

} finally {
  Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue | Out-Null
}
