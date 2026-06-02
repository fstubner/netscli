param(
    [string]$NpcapSdk = $env:NPCAP_SDK,
    [string[]]$CargoArgs = @('-p', 'netscli-core', '--features', 'pcap')
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot

if (-not $NpcapSdk) {
    $NpcapSdk = 'C:\tmp\netscli-npcap-sdk'
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
    throw "Npcap runtime was not found at '$NpcapRuntime'. Install Npcap before running PCAP tests."
}

$env:LIB = "$NpcapLib;$env:LIB"
$env:INCLUDE = "$NpcapInclude;$env:INCLUDE"
$env:PATH = "$NpcapRuntime;$env:PATH"

Set-Location $RepoRoot
cargo test @CargoArgs
