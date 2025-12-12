Param(
  [string]$OutDir = "dist-win"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$launcherRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$out = Join-Path $launcherRoot $OutDir
$bundle = Join-Path $out "bundle"

Write-Host "[launcher] repoRoot=$repoRoot"
Write-Host "[launcher] out=$out"

if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force -Path $bundle | Out-Null

Write-Host "[launcher] build web/server..."
pnpm -C $repoRoot --filter @aip/web build
pnpm -C $repoRoot --filter @aip/server build

Write-Host "[launcher] deploy server (prod node_modules)..."
pnpm -C $repoRoot --filter @aip/server deploy --prod (Join-Path $bundle "server")

Write-Host "[launcher] copy web dist..."
Copy-Item -Recurse -Force (Join-Path $repoRoot "packages\web\dist") (Join-Path $bundle "web")

Write-Host "[launcher] copy node.exe..."
$nodeExe = (Get-Command node).Source
New-Item -ItemType Directory -Force -Path (Join-Path $bundle "node") | Out-Null
Copy-Item -Force $nodeExe (Join-Path $bundle "node\node.exe")

Write-Host "[launcher] build launcher exe (single-file)..."
dotnet publish (Join-Path $launcherRoot "src\AipLauncher\AipLauncher.csproj") `
  -c Release -r win-x64 --self-contained true `
  /p:PublishSingleFile=true /p:IncludeNativeLibrariesForSelfExtract=true `
  -o (Join-Path $bundle "bin")

Copy-Item -Force (Join-Path $bundle "bin\aip-launcher.exe") (Join-Path $bundle "aip-launcher.exe")
Remove-Item -Recurse -Force (Join-Path $bundle "bin")

Write-Host "[launcher] zip..."
$zip = Join-Path $out "AIP-PDF-Viewer-win-x64.zip"
Compress-Archive -Path (Join-Path $bundle "*") -DestinationPath $zip
Write-Host "[launcher] done: $zip"


