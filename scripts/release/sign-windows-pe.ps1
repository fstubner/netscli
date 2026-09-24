# Authenticode-sign one file for the Tauri bundler.
#
# Called by `tauri build` through bundle.windows.signCommand, once per file
# it wants signed, with that file's path as the only argument. release.yml's
# Windows GUI leg writes the config that points here; nothing else uses it.
#
# Why this exists at all: until now only the MSI was signed, in
# sign-windows, after the build. The app's own .exe inside it was not, and
# that is the file SmartScreen and antivirus actually look at when the app
# runs. It is also a Microsoft Store requirement that every PE file inside
# an MSI be signed (#466). The .exe can only be signed *before* WiX packs it
# into the MSI, which means during the build, which means here.
#
# The bundler also calls this on the finished .msi. That one is skipped on
# purpose: ssign cannot sign MSI yet (its CFB pre-hash does not match
# osslsigncode's), and sign-windows already signs the MSI on Linux with
# osslsigncode, after this build. Signing it here as well would only be
# overwritten.
#
# Credentials come from the environment and are read by ssign itself --
# CERTUM_EMAIL and CERTUM_OTP -- so they never appear on a command line.
# The ssign binary is fetched and pinned by the workflow, which passes its
# path in NETSCLI_SSIGN.

param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

$ErrorActionPreference = 'Stop'

# Plain stderr and an explicit exit code. Write-Error under 'Stop' would end
# the script with exit 1 before any `exit $code` ran, so a signer that failed
# with its own code would be reported as 1, wrapped in PowerShell's
# formatting noise.
function Fail([string]$Message, [int]$Code = 1) {
    [Console]::Error.WriteLine("sign-windows-pe: $Message")
    exit $Code
}

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Fail "no such file: $Path"
}

$name = Split-Path -Leaf $Path
$extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()

if ($extension -eq '.msi') {
    Write-Host "sign-windows-pe: leaving $name for the sign-windows job"
    exit 0
}

# The bundler also hands over two files from the WiX toolset it builds the
# MSI with -- WixUtilExtension.dll and WixUIExtension.dll, from its local copy
# under target\...\wix\ -- without saying why. They are third-party build
# tools: not ours, unsigned by their publisher, and not in the MSI (it holds
# netscli-gui.exe and the OUI data file, nothing else). Signing them would
# put this project's certificate on someone else's code, and cost two more
# round-trips to Certum per build. The MSI builds the same without it --
# measured with a local build whose signer skipped them.
#
# Observed calls, from that build: target\release\netscli-gui.exe, the two
# WiX DLLs, then the finished .msi.
$segments = ($Path -replace '/', '\').ToLowerInvariant().Split('\')
if ($segments -contains 'wix') {
    Write-Host "sign-windows-pe: leaving $name alone (WiX toolset, not part of the app)"
    exit 0
}

$ssign = $env:NETSCLI_SSIGN
if (-not $ssign -or -not (Test-Path -LiteralPath $ssign -PathType Leaf)) {
    Fail "NETSCLI_SSIGN does not point at ssign.exe ('$ssign')"
}

Write-Host "sign-windows-pe: signing $name"
& $ssign $Path
if ($LASTEXITCODE -ne 0) {
    Fail "ssign exited $LASTEXITCODE for $name" $LASTEXITCODE
}

# Read the signature back through Windows' own verifier rather than trusting
# the exit code. `Valid` means signed, unmodified since, and chaining to a
# root this machine trusts -- which is the same judgement SmartScreen makes.
$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($signature.Status -ne 'Valid') {
    Fail "$name signature status is '$($signature.Status)': $($signature.StatusMessage)"
}
Write-Host "sign-windows-pe: $name signed by $($signature.SignerCertificate.Subject)"
exit 0
