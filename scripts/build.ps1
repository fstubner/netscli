<#
.SYNOPSIS
    Build NetsCLI on Windows: the CLI/TUI binary, the desktop app installers, or both.

.DESCRIPTION
    Release builds only. The desktop app is built with `tauri build`, which
    embeds the frontend and sets windows_subsystem = "windows", so the result
    runs on its own without a console window. (`cargo build -p netscli-gui` does
    not: it makes a dev binary that loads http://localhost:1420.)

    Unsigned, local builds. Code signing and the updater manifest are release-
    pipeline steps (.github/workflows/release.yml) and need secrets.

.PARAMETER Target
    cli, gui, or all (default).

.PARAMETER Bundles
    Desktop installer formats: msi, nsis, or both (default).

.PARAMETER Pcap
    Build with packet capture. Needs the Npcap SDK (NPCAP_SDK, or
    %LOCALAPPDATA%\netscli\npcap-sdk) and the Npcap runtime installed.

.PARAMETER Check
    Run fmt, clippy and the tests before building.

.EXAMPLE
    .\scripts\build.ps1
    .\scripts\build.ps1 -Target gui -Bundles nsis
    .\scripts\build.ps1 -Target cli -Pcap
#>
[CmdletBinding()]
param(
    [ValidateSet('cli', 'gui', 'all')]
    [string]$Target = 'all',

    [ValidateSet('msi', 'nsis', 'both')]
    [string]$Bundles = 'both',

    [switch]$Pcap,

    [switch]$Check,

    [string]$NpcapSdk = $env:NPCAP_SDK
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$GuiRoot = Join-Path $RepoRoot 'apps\netscli-gui'

function Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

# Native commands do not throw on a non-zero exit, so check each one.
function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "'$Exe $($Arguments -join ' ')' failed with exit code $LASTEXITCODE"
    }
}

function Require-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "'$Name' was not found on PATH. $Hint"
    }
}

# --- Prerequisites ----------------------------------------------------------

Step 'Checking prerequisites'

Require-Command 'cargo' 'Install Rust from https://rustup.rs (rust-toolchain.toml selects the pinned version).'

$buildGui = $Target -in @('gui', 'all')
$buildCli = $Target -in @('cli', 'all')

if ($buildGui) {
    Require-Command 'node' 'Install Node.js 22 or newer (see .nvmrc).'
    Require-Command 'npm' 'npm ships with Node.js.'
    $nodeMajor = [int]((node --version).TrimStart('v').Split('.')[0])
    if ($nodeMajor -lt 22) {
        throw "Node.js 22 or newer is required (found $(node --version))."
    }
}

# Running cargo inside the repo makes rustup install the pinned toolchain if needed.
Push-Location $RepoRoot
try {
    Invoke-Native 'cargo' @('--version')
} finally {
    Pop-Location
}

if ($Pcap) {
    if (-not $NpcapSdk) {
        $NpcapSdk = Join-Path $env:LOCALAPPDATA 'netscli\npcap-sdk'
    }
    $npcapLib = Join-Path $NpcapSdk 'Lib\x64'
    $npcapInclude = Join-Path $NpcapSdk 'Include'
    if (-not (Test-Path (Join-Path $npcapLib 'wpcap.lib'))) {
        throw "Npcap SDK not found at '$NpcapSdk'. Set NPCAP_SDK or pass -NpcapSdk."
    }
    $env:LIB = "$npcapLib;$env:LIB"
    $env:INCLUDE = "$npcapInclude;$env:INCLUDE"
    # Separate target dir so pcap and non-pcap builds don't keep invalidating each other.
    $env:CARGO_TARGET_DIR = Join-Path $RepoRoot 'target-pcap'
}

$targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $RepoRoot 'target' }
$started = Get-Date

# --- Optional checks --------------------------------------------------------

if ($Check) {
    Push-Location $RepoRoot
    try {
        Step 'cargo fmt --check'
        Invoke-Native 'cargo' @('fmt', '--all', '--check')
        Step 'cargo clippy'
        Invoke-Native 'cargo' @('clippy', '--all-targets', '--', '-D', 'warnings')
        Step 'cargo test'
        Invoke-Native 'cargo' @('test', '--all')
    } finally {
        Pop-Location
    }
}

# --- CLI / TUI --------------------------------------------------------------

if ($buildCli) {
    Step 'Building the CLI/TUI (netscli.exe)'
    $cliArgs = @('build', '--release', '--locked', '-p', 'netscli')
    if ($Pcap) { $cliArgs += @('--features', 'pcap') }
    Push-Location $RepoRoot
    try {
        Invoke-Native 'cargo' $cliArgs
    } finally {
        Pop-Location
    }
}

# --- Desktop app ------------------------------------------------------------

if ($buildGui) {
    Push-Location $GuiRoot
    try {
        Step 'Installing frontend dependencies (npm ci)'
        Invoke-Native 'npm' @('ci')

        if ($Check) {
            Step 'Frontend lint and unit tests'
            Invoke-Native 'npm' @('run', 'lint')
            Invoke-Native 'npm' @('run', 'test:unit')
        }

        Step 'Building the desktop app and installers (tauri build)'
        $bundleList = if ($Bundles -eq 'both') { 'msi,nsis' } else { $Bundles }
        # tauri.conf.json's beforeBuildCommand runs `npm run build` (typecheck + Vite).
        $tauriArgs = @('run', 'tauri', '--', 'build', '--bundles', $bundleList)
        if ($Pcap) { $tauriArgs += @('--features', 'pcap') }
        Invoke-Native 'npm' $tauriArgs
    } finally {
        Pop-Location
    }
}

# --- Summary ----------------------------------------------------------------

Step "Done in $([int]((Get-Date) - $started).TotalSeconds)s"

$outputs = @()
if ($buildCli) {
    $outputs += Get-Item (Join-Path $targetDir 'release\netscli.exe') -ErrorAction SilentlyContinue
}
if ($buildGui) {
    $outputs += Get-Item (Join-Path $targetDir 'release\netscli-gui.exe') -ErrorAction SilentlyContinue
    $bundleDir = Join-Path $targetDir 'release\bundle'
    $outputs += Get-ChildItem $bundleDir -Recurse -Include '*.msi', '*-setup.exe' -ErrorAction SilentlyContinue
}

foreach ($file in $outputs) {
    '{0,10:N1} MB  {1}' -f ($file.Length / 1MB), $file.FullName
}
