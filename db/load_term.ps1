# EVERY SEMESTER: loads all *.json in a folder as one term. Keeps older terms. Safe to re-run.
# Usage:
#   .\db\load_term.ps1 "Odd 2026" 2026-07-20 2026-12-05 data/odd-2026

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$TermName,

    [Parameter(Mandatory=$true, Position=1)]
    [string]$StartsOn,

    [Parameter(Mandatory=$true, Position=2)]
    [string]$EndsOn,

    [Parameter(Mandatory=$true, Position=3)]
    [string]$Folder,

    [Parameter(Position=4)]
    [string]$Status = "active",

    [string]$DatabaseUrl = $env:DATABASE_URL
)

if (-not $DatabaseUrl) {
    Write-Error "DATABASE_URL is not set. Example: `$env:DATABASE_URL = 'postgresql://postgres:password@localhost:5432/freeclass'"
    exit 1
}

$Dir = (Resolve-Path $Folder).Path
$activate = if ($Status -eq "inactive") { "false" } else { "true" }

$jsonFiles = @(Get-ChildItem -Path $Dir -Filter *.json)
if ($jsonFiles.Count -eq 0) {
    Write-Error "No .json files found in $Dir"
    exit 1
}

$scriptDir = $PSScriptRoot
$env:PGCLIENTENCODING = 'UTF8'

Write-Host "Truncating staging..."
psql $DatabaseUrl -v ON_ERROR_STOP=1 -q -c "TRUNCATE fc.stg_room_json"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Loading JSON files into staging..."
foreach ($f in $jsonFiles) {
    $json = Get-Content -Raw -Encoding UTF8 $f.FullName
    "INSERT INTO fc.stg_room_json(src, doc) VALUES ('$($f.Name)', `$j`$$json`$j`$::jsonb);" |
        psql $DatabaseUrl -v ON_ERROR_STOP=1 -q -f -
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Running 02_etl.sql for term '$TermName'..."
psql $DatabaseUrl -v ON_ERROR_STOP=1 -q -v term_name="$TermName" -v term_start="$StartsOn" -v term_end="$EndsOn" -v activate=$activate -f "$scriptDir\02_etl.sql"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Refreshing materialized view..."
psql $DatabaseUrl -v ON_ERROR_STOP=1 -q -c "REFRESH MATERIALIZED VIEW fc.mv_room_utilisation"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Loaded term '$TermName' from $($jsonFiles.Count) file(s)"
