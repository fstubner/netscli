param(
    [string]$NpcapSdk = $env:NPCAP_SDK
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$GuiRoot = Join-Path $RepoRoot 'apps\netscli-gui'

if (-not $NpcapSdk) {
    # Default under LOCALAPPDATA, not C:\tmp (B-33).
    #
    # C:\tmp is predictable and not ACL'd, so any local user could plant a
    # Lib\x64\wpcap.lib there: it passes the existence check below and gets
    # linked into the developer's build. LOCALAPPDATA is per-user.
    # docs/RELEASE.md steers maintainers through this script during the
    # release gate, which is exactly when that matters.
    $NpcapSdk = Join-Path $env:LOCALAPPDATA 'netscli\npcap-sdk'
}

$NpcapLib = Join-Path $NpcapSdk 'Lib\x64'
$NpcapInclude = Join-Path $NpcapSdk 'Include'
$NpcapRuntime = 'C:\Windows\System32\Npcap'

if (-not (Test-Path (Join-Path $NpcapLib 'wpcap.lib'))) {
    throw "Npcap SDK import library was not found at '$NpcapLib'. Set NPCAP_SDK to the extracted Npcap SDK directory."
}

if (-not (Test-Path $NpcapInclude)) {
    throw "Npcap SDK include directory was not found at '$NpcapInclude'. Set NPCAP_SDK to the extracted Npcap SDK directory."
}

if (-not (Test-Path (Join-Path $NpcapRuntime 'wpcap.dll'))) {
    throw "Npcap runtime was not found at '$NpcapRuntime'. Install Npcap before running the PCAP desktop app."
}

$env:LIB = "$NpcapLib;$env:LIB"
$env:INCLUDE = "$NpcapInclude;$env:INCLUDE"
$env:PATH = "$NpcapRuntime;$env:PATH"
$env:CARGO_TARGET_DIR = Join-Path $RepoRoot 'target-pcap'

Set-Location $GuiRoot
npm run tauri:dev:pcap
