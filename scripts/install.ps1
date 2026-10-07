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
#   - NETSCLI_NPCAP_SIGNER: Override the Authenticode signer name the Npcap
#     installer must carry (default: the Nmap Project's two published
#     signing names). The installer is not run if it does not match.
#   - NETSCLI_SHA256 / NETSCLI_SHA256_URL: supply the expected checksum
#     explicitly. By default the installer fetches "<asset>.sha256" from
#     the release and REFUSES to install if it cannot be verified.
#   - NETSCLI_ALLOW_UNVERIFIED=1: install without checksum verification
#     (not recommended; only for releases that publish no checksum asset)
#   - NETSCLI_SIGNER: the Authenticode signer netscli.exe must carry
#     (default: "Open Source Developer Felix Stubner", the CN of the
#     project's Certum certificate)
#   - NETSCLI_SKIP_SIGNATURE=1: do not check the Authenticode signature
#
# What is verified before anything is installed:
#   - The SHA-256 of netscli.exe, against "<asset>.sha256" from the same
#     release (or NETSCLI_SHA256 / NETSCLI_SHA256_URL). That proves the
#     download is intact, not who built it, since both come from one place.
#   - Its Authenticode signature: Windows must report it Valid (signed,
#     unchanged since, chaining to a root this machine trusts) and the signer
#     must be NETSCLI_SIGNER. A bad signature stops the install. Skipped,
#     with a note, for a pinned NETSCLI_VERSION older than v0.3.3 (the first
#     signed release), for a REPO other than fstubner/netscli unless
#     NETSCLI_SIGNER is set, and where Get-AuthenticodeSignature does not
#     exist.
# The script says what it checked.

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

# Running the Npcap installer elevated is the most dangerous thing this
# script does, and until now it did so on bytes fetched over a
# user-overridable URL with nothing checked at all. release.yml's "Install
# Npcap SDK" step refuses to do the equivalent for the Npcap *SDK* — it pins
# a SHA256 rather than let an unverified third-party download into a binary
# we then cosign-sign.
#
# A pinned hash is the wrong tool here, though. npcap.com serves a new
# installer on every point release, so a pin would break `NETSCLI_PCAP=1` on
# a schedule nobody here controls, and a check that breaks on a schedule is a
# check people learn to disable. Authenticode survives version bumps: the
# Nmap Project signs every Npcap release, so verify the signature is valid
# and the signer is who we expect.
#
# Two names are accepted because the project's code signing key was reissued
# to "Nmap Software LLC" in Npcap 1.76 (2023-07-19), replacing the older
# "Insecure.Com LLC" — which anything a user pins with NETSCLI_NPCAP_URL
# below that version still carries.
function Test-NpcapSignature([string]$path) {
  $accepted = if ($env:NETSCLI_NPCAP_SIGNER) {
    @($env:NETSCLI_NPCAP_SIGNER)
  } else {
    @("Nmap Software LLC", "Insecure.Com LLC")
  }

  $sig = Get-AuthenticodeSignature -FilePath $path
  if ($sig.Status -ne "Valid") {
    Write-Host "Npcap installer signature is not valid (status: $($sig.Status))." -ForegroundColor Red
    if ($sig.StatusMessage) {
      Write-Host "  $($sig.StatusMessage)" -ForegroundColor Red
    }
    return $false
  }
  if (-not $sig.SignerCertificate) {
    Write-Host "Npcap installer carries no signer certificate." -ForegroundColor Red
    return $false
  }

  # SimpleName is the certificate's CN on its own, which avoids parsing the
  # full distinguished name (the rest of which — locality, serial — changes
  # whenever the cert is reissued).
  $signer = $sig.SignerCertificate.GetNameInfo(
    [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)

  foreach ($name in $accepted) {
    if ($signer -eq $name) {
      Write-Host "Npcap installer signed by: $signer" -ForegroundColor Green
      return $true
    }
  }

  Write-Host "Npcap installer is signed by '$signer', which is not an accepted signer." -ForegroundColor Red
  Write-Host "Expected one of: $($accepted -join ', ')" -ForegroundColor Red
  Write-Host "Set NETSCLI_NPCAP_SIGNER if the Nmap Project has published a new signing name." -ForegroundColor Yellow
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

  # Fail closed. Verification comes before the elevation prompt, not after,
  # so an installer we cannot vouch for is never handed admin rights.
  Write-Host "Verifying Npcap installer signature..." -ForegroundColor Cyan
  if (-not (Test-NpcapSignature $npcapExe)) {
    Write-Host "Refusing to run an unverified Npcap installer." -ForegroundColor Red
    return $false
  }

  Write-Host "Launching Npcap installer (admin required)..." -ForegroundColor Cyan
  $proc = Start-Process -FilePath $npcapExe -Wait -PassThru
  return $proc.ExitCode -eq 0
}

# netscli.exe is Authenticode-signed from v0.3.3 on. A pinned version older
# than that is the one release that may lack a signature; "latest" and
# anything newer must have one. A version that does not parse is treated as
# signed, so the check is never skipped by accident.
function Test-SignedRelease([string]$version) {
  if (-not $version -or $version.Trim().Length -eq 0) { return $true }
  if ($version.Trim() -match '^v?(\d+)\.(\d+)\.(\d+)') {
    $pinned = [version]::new([int]$Matches[1], [int]$Matches[2], [int]$Matches[3])
    return $pinned -ge [version]::new(0, 3, 3)
  }
  return $true
}

# The same check Test-NpcapSignature makes, for netscli.exe itself. Valid
# means signed, unmodified since, and chaining to a root this machine
# trusts, which is the judgement SmartScreen makes too. The signer is
# compared by CN alone, as for Npcap, so a reissued certificate with the
# same name keeps passing.
function Test-NetscliSignature([string]$path, [string]$expectedSigner) {
  $sig = Get-AuthenticodeSignature -FilePath $path
  if ($sig.Status -ne "Valid") {
    Write-Host "netscli.exe's signature is not valid (status: $($sig.Status))." -ForegroundColor Red
    if ($sig.StatusMessage) {
      Write-Host "  $($sig.StatusMessage)" -ForegroundColor Red
    }
    return $false
  }
  if (-not $sig.SignerCertificate) {
    Write-Host "netscli.exe carries no signer certificate." -ForegroundColor Red
    return $false
  }
  $signer = $sig.SignerCertificate.GetNameInfo(
    [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($signer -ne $expectedSigner) {
    Write-Host "netscli.exe is signed by '$signer', not by '$expectedSigner'." -ForegroundColor Red
    return $false
  }
  Write-Host "netscli.exe signed by: $signer" -ForegroundColor Green
  return $true
}

# Everything the installer does. In a function so that its variables and
# its $ErrorActionPreference stay inside it: run as `iwr ... | iex`, the
# script runs in the caller's own PowerShell session, and top-level
# assignments were left behind there.
#
# A failure throws rather than calling `exit`. Under `iex`, `exit` ended the
# caller's session, closing the window and the error message with it. A
# thrown error leaves the window open, and still ends `powershell -File`
# or `-Command` with exit code 1.
function Install-NetsCLI {
  $ErrorActionPreference = "Stop"

  $INSTALL_DIR = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { "$env:USERPROFILE\.cargo\bin" }
  $BINARY_NAME = "netscli.exe"
  $REPO = if ($env:REPO) { $env:REPO } else { "fstubner/netscli" }
  $NETSCLI_VERSION = if ($env:NETSCLI_VERSION) { $env:NETSCLI_VERSION } else { "" }
  $NETSCLI_SHA256 = if ($env:NETSCLI_SHA256) { $env:NETSCLI_SHA256 } else { "" }
  $NETSCLI_SHA256_URL = if ($env:NETSCLI_SHA256_URL) { $env:NETSCLI_SHA256_URL } else { "" }
  $NETSCLI_PCAP = if ($env:NETSCLI_PCAP) { $env:NETSCLI_PCAP } else { "" }
  $NETSCLI_SKIP_NPCAP = if ($env:NETSCLI_SKIP_NPCAP) { $env:NETSCLI_SKIP_NPCAP } else { "" }
  $NETSCLI_ALLOW_UNVERIFIED = if ($env:NETSCLI_ALLOW_UNVERIFIED) { $env:NETSCLI_ALLOW_UNVERIFIED } else { "" }
  $NETSCLI_SIGNER = if ($env:NETSCLI_SIGNER) { $env:NETSCLI_SIGNER } else { "Open Source Developer Felix Stubner" }
  $NETSCLI_SKIP_SIGNATURE = if ($env:NETSCLI_SKIP_SIGNATURE) { $env:NETSCLI_SKIP_SIGNATURE } else { "" }

  # Backwards-compat: older docs used NETSCLI_INSTALL_NPCAP as a separate toggle.
  # If the user set it, fold it into NETSCLI_PCAP so the old invocation works.
  if (-not $NETSCLI_PCAP -and $env:NETSCLI_INSTALL_NPCAP) {
      $NETSCLI_PCAP = $env:NETSCLI_INSTALL_NPCAP
  }

  $NETSCLI_NPCAP_URL = if ($env:NETSCLI_NPCAP_URL) { $env:NETSCLI_NPCAP_URL } else { "https://npcap.com/dist/npcap-1.80.exe" }

  Write-Host "NetsCLI Installer" -ForegroundColor Cyan
  Write-Host "=================" -ForegroundColor Cyan
  Write-Host ""

  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($arch -ne "AMD64") {
    Write-Host "Unsupported architecture: $arch (expected AMD64)." -ForegroundColor Red
    throw "NetsCLI was not installed: unsupported architecture $arch."
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
      throw "NetsCLI was not installed: the download failed."
    }

    if (-not (Test-Path $tmpExe)) {
      Write-Host "Download failed: $tmpExe not found." -ForegroundColor Red
      throw "NetsCLI was not installed: the download failed."
    }

    # What was checked, for the line printed before installing.
    $checked = @()
    $sumSource = "the SHA-256 given in NETSCLI_SHA256"
    if ($NETSCLI_SHA256_URL -and $NETSCLI_SHA256_URL.Trim().Length -gt 0) {
      Write-Host "Fetching checksum from: $NETSCLI_SHA256_URL" -ForegroundColor Cyan
      $checksumResponse = Invoke-WebRequest -Uri $NETSCLI_SHA256_URL
      $NETSCLI_SHA256 = ($checksumResponse.Content -split '\s+')[0]
      $sumSource = "the SHA-256 from NETSCLI_SHA256_URL"
    } elseif (-not $NETSCLI_SHA256 -or $NETSCLI_SHA256.Trim().Length -eq 0) {
      $sumSource = "the SHA-256 published with this release"
      # Every release since v0.2.x publishes "<asset>.sha256". Fetch it — and
      # treat its absence as a failure, not as permission to skip
      # verification. An attacker on the path can always make one request
      # fail; if that silently downgraded us to "install unverified", the
      # checksum would be worth nothing.
      $autoChecksumUrl = "$DOWNLOAD_URL.sha256"
      try {
        $checksumResponse = Invoke-WebRequest -Uri $autoChecksumUrl
        $NETSCLI_SHA256 = ($checksumResponse.Content -split '\s+')[0]
      } catch {
        Write-Host "ERROR: could not fetch $autoChecksumUrl" -ForegroundColor Red
        Write-Host "Refusing to install an unverified binary." -ForegroundColor Red
        Write-Host ""
        Write-Host "If this release genuinely has no checksum asset, supply one explicitly:" -ForegroundColor Yellow
        Write-Host '  $env:NETSCLI_SHA256="<digest>"           # known digest' -ForegroundColor Yellow
        Write-Host '  $env:NETSCLI_SHA256_URL="<url>"          # digest fetched from elsewhere' -ForegroundColor Yellow
        Write-Host '  $env:NETSCLI_ALLOW_UNVERIFIED=1          # opt out (not recommended)' -ForegroundColor Yellow
        throw "NetsCLI was not installed: there was no checksum to verify it against."
      }
    }

    if ($NETSCLI_SHA256 -and $NETSCLI_SHA256.Trim().Length -gt 0) {
      $expected = $NETSCLI_SHA256.Trim().ToLower()
      if ($expected -notmatch '^[0-9a-f]{64}$') {
        Write-Host "ERROR: checksum is not a 64-character hex digest: '$expected'" -ForegroundColor Red
        throw "NetsCLI was not installed: the checksum is malformed."
      }
      Write-Host "Verifying checksum..." -ForegroundColor Cyan
      $hash = (Get-FileHash -Algorithm SHA256 -Path $tmpExe).Hash.ToLower()
      if ($hash -ne $expected) {
        Write-Host "Checksum mismatch. Expected $expected, got $hash" -ForegroundColor Red
        throw "NetsCLI was not installed: its checksum did not match."
      }
      $checked += $sumSource
    } elseif (Test-True $NETSCLI_ALLOW_UNVERIFIED) {
      Write-Host "Warning: installing WITHOUT checksum verification (NETSCLI_ALLOW_UNVERIFIED=1)." -ForegroundColor Yellow
    } else {
      Write-Host "ERROR: no checksum available and NETSCLI_ALLOW_UNVERIFIED is not set." -ForegroundColor Red
      throw "NetsCLI was not installed: there was no checksum to verify it against."
    }

    # The checksum above comes from the same release as the binary, so it
    # proves the download is intact but not who built it. The Authenticode
    # signature does, and Windows checks it locally. A signature that does
    # not check out stops the install; the cases where there is nothing to
    # check, or no way to check it, are said out loud instead.
    if (Test-True $NETSCLI_SKIP_SIGNATURE) {
      Write-Host "Not checked: the Authenticode signature (NETSCLI_SKIP_SIGNATURE=1)." -ForegroundColor Yellow
    } elseif ($REPO -ne "fstubner/netscli" -and -not $env:NETSCLI_SIGNER) {
      Write-Host "Not checked: the Authenticode signature. REPO is $REPO, so set NETSCLI_SIGNER to its signer to check it." -ForegroundColor Yellow
    } elseif (-not (Test-SignedRelease $NETSCLI_VERSION)) {
      Write-Host "Not checked: the Authenticode signature. $NETSCLI_VERSION is older than v0.3.3, the first signed release." -ForegroundColor Yellow
    } elseif (-not (Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue)) {
      Write-Host "Not checked: the Authenticode signature. Get-AuthenticodeSignature is not available in this PowerShell." -ForegroundColor Yellow
    } else {
      Write-Host "Verifying the Authenticode signature..." -ForegroundColor Cyan
      if (-not (Test-NetscliSignature $tmpExe $NETSCLI_SIGNER)) {
        Write-Host "Refusing to install a binary whose signature does not check out." -ForegroundColor Red
        Write-Host "If you know why, NETSCLI_SKIP_SIGNATURE=1 skips this check." -ForegroundColor Yellow
        throw "NetsCLI was not installed: its signature did not check out."
      }
      $checked += "the Authenticode signature by $NETSCLI_SIGNER"
    }
    if ($checked.Count -gt 0) {
      Write-Host "Checked: $($checked -join ', and ')." -ForegroundColor Green
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
}

Install-NetsCLI
