# Fail unless every executable inside an MSI carries a valid signature.
#
#   pwsh -File scripts/release/check-msi-signed.ps1 <path-to.msi>
#
# The MSI itself is signed later, in sign-windows, so this looks only at what
# is inside it: the files WiX packed, which is where the app that actually
# runs lives. v0.3.3 shipped with the MSI signed and netscli-gui.exe inside it
# not, which a check on the MSI alone reports as fine. That is the gap this
# closes.
#
# Extraction uses an administrative install (`msiexec /a`), which unpacks the
# files to a folder without installing or registering anything, and needs no
# elevation.

param(
    [Parameter(Mandatory = $true)]
    [string]$Msi
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
    [Console]::Error.WriteLine("check-msi-signed: $Message")
    exit 1
}

if (-not (Test-Path -LiteralPath $Msi -PathType Leaf)) {
    Fail "no such file: $Msi"
}

$out = Join-Path ([IO.Path]::GetTempPath()) ("msi-contents-" + [guid]::NewGuid().ToString('N'))
$msiexec = Start-Process msiexec.exe -Wait -PassThru -ArgumentList @(
    '/a', "`"$((Resolve-Path -LiteralPath $Msi).Path)`"", '/qn', "TARGETDIR=`"$out`""
)
if ($msiexec.ExitCode -ne 0) {
    Fail "msiexec /a exited $($msiexec.ExitCode) extracting $Msi"
}

$executables = @(Get-ChildItem -LiteralPath $out -Recurse -File |
    Where-Object { $_.Extension -in '.exe', '.dll' })

# An MSI with no executables in it is not a pass: it means extraction or the
# build went wrong in a way that would otherwise read as "nothing unsigned".
if ($executables.Count -eq 0) {
    Fail "found no .exe or .dll inside $Msi"
}

$unsigned = @()
foreach ($file in $executables) {
    $status = (Get-AuthenticodeSignature -LiteralPath $file.FullName).Status
    Write-Host ("  {0,-40} {1}" -f $file.Name, $status)
    if ($status -ne 'Valid') { $unsigned += $file.Name }
}

Remove-Item -LiteralPath $out -Recurse -Force -ErrorAction SilentlyContinue

if ($unsigned.Count -gt 0) {
    Fail ("not validly signed inside the MSI: " + ($unsigned -join ', '))
}
Write-Host "check-msi-signed: all $($executables.Count) executable(s) inside the MSI are signed"
exit 0
