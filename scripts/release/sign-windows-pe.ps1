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

# Everything this prints also goes to the job summary. The bundler captures
# the command's stdout and stderr and, when it fails, reports only "failed to
# run pwsh": the v0.3.4 release lost its Windows build that way with no
# reason anywhere in the log. The summary file is the one place a child of
# the bundler can still reach. Credentials are blanked first, because ssign's
# own messages may repeat them.
function Log([string]$Message) {
    Write-Host "sign-windows-pe: $Message"
    if ($env:GITHUB_STEP_SUMMARY) {
        $text = $Message
        foreach ($secret in @($env:CERTUM_EMAIL, $env:CERTUM_OTP)) {
            if ($secret) { $text = $text.Replace($secret, '***') }
        }
        Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value "sign-windows-pe: $text"
    }
}

# Plain stderr and an explicit exit code. Write-Error under 'Stop' would end
# the script with exit 1 before any `exit $code` ran, so a signer that failed
# with its own code would be reported as 1, wrapped in PowerShell's
# formatting noise.
function Fail([string]$Message, [int]$Code = 1) {
    Log "FAILED: $Message"
    [Console]::Error.WriteLine("sign-windows-pe: $Message")
    exit $Code
}

Log "called for '$Path' (pwsh $($PSVersionTable.PSVersion))"

if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Fail "no such file: $Path"
}

$name = Split-Path -Leaf $Path
$extension = [IO.Path]::GetExtension($Path).ToLowerInvariant()

if ($extension -eq '.msi') {
    Log "leaving $name for the sign-windows job"
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
    Log "leaving $name alone (WiX toolset, not part of the app)"
    exit 0
}

$ssign = $env:NETSCLI_SSIGN
if (-not $ssign -or -not (Test-Path -LiteralPath $ssign -PathType Leaf)) {
    Fail "NETSCLI_SSIGN does not point at ssign.exe ('$ssign')"
}

# Sign a copy, then write it back over the original in place.
#
# ssign signs in place by writing a new file and renaming it over the old
# one, and inside the bundler that rename is refused: "atomically replacing
# ...netscli-gui.exe: Access is denied (os error 5)", which is what lost
# v0.3.4 its Windows build. Something still holds the freshly patched exe
# open without delete sharing, so it cannot be replaced, but it can be
# written. `-o` puts the signed file elsewhere; copying its bytes over the
# original needs only write access, and is retried in case the holder is a
# scanner that lets go after a moment.
$signedDir = Join-Path ([IO.Path]::GetTempPath()) ("sign-windows-pe-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $signedDir | Out-Null
Log "signing $name"
$output = & $ssign -o $signedDir $Path 2>&1 | Out-String
$code = $LASTEXITCODE
Log "ssign exited $code. Output:`n$($output.Trim())"
if ($code -ne 0) {
    Fail "ssign exited $code for $name" $code
}
$signed = Join-Path $signedDir $name
if (-not (Test-Path -LiteralPath $signed -PathType Leaf)) {
    Fail "ssign reported success but wrote no $signed"
}

$bytes = [IO.File]::ReadAllBytes($signed)
for ($attempt = 1; ; $attempt++) {
    try {
        $stream = [IO.File]::Open($Path, 'Open', 'Write', 'ReadWrite')
        try {
            $stream.SetLength(0)
            $stream.Write($bytes, 0, $bytes.Length)
        } finally {
            $stream.Dispose()
        }
        break
    } catch {
        if ($attempt -ge 10) {
            Fail "could not write the signed bytes back to $name after $attempt tries: $($_.Exception.Message)"
        }
        Log "write-back attempt $attempt failed ($($_.Exception.Message)); retrying"
        Start-Sleep -Seconds 1
    }
}
Remove-Item -LiteralPath $signedDir -Recurse -Force
Log "wrote the signed $name back in place"

# Read the signature back through Windows' own verifier rather than trusting
# the exit code. `Valid` means signed, unmodified since, and chaining to a
# root this machine trusts -- which is the same judgement SmartScreen makes.
$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($signature.Status -ne 'Valid') {
    Fail "$name signature status is '$($signature.Status)': $($signature.StatusMessage)"
}
Log "$name signed by $($signature.SignerCertificate.Subject)"
exit 0
