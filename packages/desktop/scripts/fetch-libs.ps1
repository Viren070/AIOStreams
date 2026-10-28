# Downloads the libmpv and Vulkan loader that libs.pin names into vendor/<arch>/, where debug builds
# and packaging look for them.
param(
  [ValidateSet('x86_64', 'aarch64')]
  [string]$Arch = 'x86_64'
)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$pin = @{}
Get-Content (Join-Path $root 'libs.pin') |
  Where-Object { $_ -match '^(\w+)=(\S+)$' } |
  ForEach-Object { $pin[$Matches[1]] = $Matches[2] }

$vendor = Join-Path $root "vendor/$Arch"
# Starts empty, as each release names its FFmpeg DLLs by version.
Remove-Item $vendor -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $vendor | Out-Null

function Expand-Download($url, $name, $sha, $out, $mode, [string[]]$files) {
  $archive = Join-Path $env:TEMP $name
  Write-Host "Downloading $name"
  Invoke-WebRequest $url -OutFile $archive
  $hash = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
  if ($hash -ne $sha) { throw "$name has SHA-256 $hash, not the pinned $sha" }
  & 7z $mode $archive "-o$out" @files -y | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '7z failed; is 7-Zip on PATH?' }
  Remove-Item $archive
}

$libs = $pin['libs']
$zip = "libs-windows-$Arch.zip"
$url = "https://github.com/AIOStreams/libs/releases/download/$libs/$zip"
Expand-Download $url $zip $pin["libs_$Arch"] $vendor x
Set-Content (Join-Path $vendor 'libmpv.version') $libs

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
Expand-Download $url "$folder.zip" $pin["vulkan_$Arch"] (Join-Path $vendor 'vulkan') e $dll, "$folder/VulkanRT-License.txt"

Write-Host "libmpv ($libs) and vulkan-1.dll ($vulkan) for $Arch are in $vendor"
