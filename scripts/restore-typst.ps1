<#
.SYNOPSIS
  Fetches the pinned Typst binary into Mnemo.Host/TypstRuntime/binaries/<rid>/.

.DESCRIPTION
  The Typst binary (~52 MB per RID) is not committed; this script restores it from the
  GitHub release pinned in scripts/typst-manifest.json, verifying the archive checksum.
  The mitex package under Mnemo.Host/TypstRuntime/typst-packages/ IS committed, so it is
  not fetched here. Run once after cloning; re-run with -Force to re-fetch.

  CI passes -Rid explicitly (one per build-matrix leg); local devs can omit it to get the
  host RID.

.PARAMETER Rid
  Target runtime identifier. Defaults to the host RID. One of the keys in the manifest.

.PARAMETER Force
  Re-fetch even if the binary is already present.
#>
[CmdletBinding()]
param(
  [string]$Rid,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir
$manifest  = Get-Content (Join-Path $scriptDir 'typst-manifest.json') -Raw | ConvertFrom-Json

function Resolve-HostRid {
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  $archTag = switch ($arch) {
    'X64'   { 'x64' }
    'Arm64' { 'arm64' }
    default { throw "Unsupported architecture: $arch" }
  }
  if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) { return "win-$archTag" }
  if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Linux))   { return "linux-$archTag" }
  if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::OSX))     { return "osx-$archTag" }
  throw 'Unsupported OS platform.'
}

if (-not $Rid) { $Rid = Resolve-HostRid }

$entry = $manifest.rids.$Rid
if (-not $entry) {
  throw "No Typst binary pinned for RID '$Rid'. Known RIDs: $($manifest.rids.PSObject.Properties.Name -join ', ')"
}

$destDir    = Join-Path $repoRoot "Mnemo.Host/TypstRuntime/binaries/$Rid"
$destBinary = Join-Path $destDir $entry.binary

if ((Test-Path $destBinary) -and -not $Force) {
  Write-Host "Typst $($manifest.typstVersion) for $Rid already present at $destBinary (use -Force to re-fetch)."
  exit 0
}

$url = "$($manifest.baseUrl)/$($entry.asset)"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("typst-restore-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
try {
  $archive = Join-Path $tmp $entry.asset
  Write-Host "Downloading $url ..."
  Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing

  $actual = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $entry.sha256.ToLowerInvariant()) {
    throw "Checksum mismatch for $($entry.asset).`n  expected $($entry.sha256)`n  actual   $actual"
  }
  Write-Host "Checksum OK."

  $extractDir = Join-Path $tmp 'x'
  New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
  if ($entry.asset.EndsWith('.zip')) {
    Expand-Archive -Path $archive -DestinationPath $extractDir -Force
  } else {
    # tar handles .tar.xz on Windows 10+, Linux, and macOS.
    tar -xf $archive -C $extractDir
    if ($LASTEXITCODE -ne 0) { throw "tar extraction failed for $($entry.asset)." }
  }

  $found = Get-ChildItem -Path $extractDir -Recurse -File -Filter $entry.binary | Select-Object -First 1
  if (-not $found) { throw "Binary '$($entry.binary)' not found inside $($entry.asset)." }

  New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  Copy-Item -Path $found.FullName -Destination $destBinary -Force

  # Copy-Item does not carry the archive's mode bits across, and release.yml runs this
  # script through pwsh on the unix legs as well, so without this Typst is restored
  # without its execute bit and PDF export fails at first use rather than at build time.
  if (-not [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) {
    chmod +x $destBinary
    if ($LASTEXITCODE -ne 0) { throw "Could not set the execute bit on $destBinary." }
  }

  Write-Host "Installed Typst $($manifest.typstVersion) for $Rid -> $destBinary"
}
finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
