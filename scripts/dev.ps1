$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$dotnet = Join-Path $projectRoot ".tools\dotnet\dotnet.exe"
$serverProject = Join-Path $projectRoot "apps\server\src\CyTask.Api\CyTask.Api.csproj"
$webRoot = Join-Path $projectRoot "apps\web"
$cyAnnotaRoot = Join-Path $projectRoot "plugins\cyannota\web"
$previousAspnetEnvironment = $env:ASPNETCORE_ENVIRONMENT

if (-not (Test-Path -LiteralPath $dotnet)) {
    throw "SDK local absent : installez .NET 10.0.302 dans .tools/dotnet."
}

$env:ASPNETCORE_ENVIRONMENT = "Development"
$cyAnnota = Start-Process -FilePath "npm.cmd" `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory $cyAnnotaRoot `
    -WindowStyle Hidden `
    -PassThru
$server = Start-Process -FilePath $dotnet `
    -ArgumentList @("run", "--project", $serverProject, "--no-launch-profile", "--urls", "http://127.0.0.1:5080") `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -PassThru

try {
    Push-Location $webRoot
    npm run dev
}
finally {
    Pop-Location
    if (-not $server.HasExited) {
        Stop-Process -Id $server.Id
    }
    if (-not $cyAnnota.HasExited) {
        Stop-Process -Id $cyAnnota.Id
    }
    $env:ASPNETCORE_ENVIRONMENT = $previousAspnetEnvironment
}
