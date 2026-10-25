# Installs the Miracle - Video Downloader companion app for the current user.
#
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-ExtensionId <id>] [-SkipFfmpeg]
#
# - builds MiracleHost.exe from host.cs with the C# compiler that ships with Windows
# - downloads yt-dlp.exe and ffmpeg.exe (official GitHub releases)
# - registers the native messaging host for Edge, Chrome and Brave (HKCU, no admin needed)

param(
    # The unpacked extension's ID (fixed by the "key" in manifest.json). Add the
    # Edge Add-ons store ID here as well once the extension is published.
    [string[]]$ExtensionId = @('abldpofjnohhincmipncnocmahoknblo'),
    [switch]$SkipFfmpeg
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is very slow with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$HostName = 'com.miracle.videodownloader'
$InstallDir = Join-Path $env:LOCALAPPDATA 'MiracleVideoDownloader'
$Exe = Join-Path $InstallDir 'MiracleHost.exe'
$YtDlpUrl = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
$FfmpegUrl = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'

New-Item -ItemType Directory -Force $InstallDir | Out-Null

Write-Host 'Building companion app...'
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw 'The .NET Framework 4 C# compiler was not found.' }
& $csc /nologo /optimize /target:exe "/out:$Exe" /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'host.cs')
if ($LASTEXITCODE -ne 0) { throw 'Building the companion app failed.' }

Write-Host 'Downloading yt-dlp...'
Invoke-WebRequest $YtDlpUrl -OutFile (Join-Path $InstallDir 'yt-dlp.exe') -UseBasicParsing

if (-not $SkipFfmpeg) {
    Write-Host 'Downloading ffmpeg (about 190 MB)...'
    $zip = Join-Path $env:TEMP 'avd-ffmpeg.zip'
    $unzipped = Join-Path $env:TEMP 'avd-ffmpeg'
    Invoke-WebRequest $FfmpegUrl -OutFile $zip -UseBasicParsing
    if (Test-Path $unzipped) { Remove-Item -Recurse -Force $unzipped }
    Expand-Archive $zip -DestinationPath $unzipped
    foreach ($tool in 'ffmpeg.exe', 'ffprobe.exe') {
        $found = Get-ChildItem $unzipped -Recurse -Filter $tool | Select-Object -First 1
        if (-not $found) { throw "$tool not found in the ffmpeg archive." }
        Copy-Item $found.FullName (Join-Path $InstallDir $tool) -Force
    }
    Remove-Item -Recurse -Force $zip, $unzipped
}

Write-Host 'Registering with browsers...'
$manifestPath = Join-Path $InstallDir "$HostName.json"
$manifest = [ordered]@{
    name            = $HostName
    description     = 'Miracle - Video Downloader companion app'
    path            = $Exe
    type            = 'stdio'
    allowed_origins = @($ExtensionId | ForEach-Object { "chrome-extension://$_/" })
}
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

$browsers = @(
    'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts',
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
    'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts'
)
foreach ($root in $browsers) {
    $key = Join-Path $root $HostName
    New-Item -Force $key | Out-Null
    Set-ItemProperty $key -Name '(default)' -Value $manifestPath
}

Write-Host ''
Write-Host "Installed to $InstallDir" -ForegroundColor Green
Write-Host 'Restart your browser, then open a YouTube video and click the Miracle - Video Downloader icon.'
