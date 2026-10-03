# Downloads the libmpv and Vulkan loader that libmpv.pin names into vendor/<arch>/, where
# debug builds and packaging look for them. -Tag fetches another shinchiro release, unchecked.
param(
  [ValidateSet('x86_64', 'aarch64')]
  [string]$Arch = 'x86_64',
  [string]$Tag
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$pin = @{}
Get-Content (Join-Path $root 'libmpv.pin') |
  Where-Object { $_ -match '^(\w+)=(\S+)$' } |
  ForEach-Object { $pin[$Matches[1]] = $Matches[2] }
$pinned = -not $Tag
if ($pinned) { $Tag = $pin['tag'] }

$vendor = Join-Path $root "vendor/$Arch"
New-Item -ItemType Directory -Force $vendor | Out-Null

function Expand-Download($url, $name, $sha, $out, [string[]]$files) {
  $archive = Join-Path $env:TEMP $name
  Write-Host "Downloading $name"
  Invoke-WebRequest $url -OutFile $archive
  if ($sha) {
    $hash = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
    if ($hash -ne $sha) { throw "$name has SHA-256 $hash, not the pinned $sha" }
  }
  & 7z e $archive "-o$out" @files -y | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '7z failed; is 7-Zip on PATH?' }
  Remove-Item $archive
}

$headers = @{}
if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $env:GITHUB_TOKEN" }
$api = "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/tags/$Tag"
try {
  $release = Invoke-RestMethod $api -Headers $headers
} catch {
  throw "libmpv release $Tag was not found at shinchiro/mpv-winbuild-cmake; bump libmpv.pin. ($_)"
}
$asset = $release.assets | Where-Object { $_.name -match "^mpv-dev-$Arch-\d" } | Select-Object -First 1
if (-not $asset) { throw "No mpv-dev-$Arch archive in release $Tag" }
$sha = if ($pinned) { $pin[$Arch] }
Expand-Download $asset.browser_download_url $asset.name $sha $vendor libmpv-2.dll
Set-Content (Join-Path $vendor 'libmpv.version') $Tag

$vulkan = $pin['vulkan']
if ($Arch -eq 'x86_64') {
  $folder = "VulkanRT-X64-$vulkan-Components"
  $url = "https://sdk.lunarg.com/sdk/download/$vulkan/windows/$folder.zip"
  $dll = "$folder/x64/vulkan-1.dll"
} else {
  $folder = "VulkanRT-ARM64-$vulkan-Components"
  $url = "https://sdk.lunarg.com/sdk/download/$vulkan/warm/$folder.zip"
  $dll = "$folder/vulkan-1.dll"
}
Expand-Download $url "$folder.zip" $pin["vulkan_$Arch"] (Join-Path $vendor 'vulkan') $dll, "$folder/VulkanRT-License.txt"

Write-Host "libmpv-2.dll ($Tag) and vulkan-1.dll ($vulkan) for $Arch are in $vendor"
