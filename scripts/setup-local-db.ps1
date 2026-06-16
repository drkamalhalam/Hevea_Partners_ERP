$ErrorActionPreference = "Stop"

$root = "C:\Users\Kamal PC\Downloads\ReplitExport-drkamalhalam\Rubber-Plantation-Partner"
$zipUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.2-1-windows-x64-binaries.zip"
$zipFile = Join-Path $root "postgresql.zip"
$pgsqlDir = Join-Path $root "pgsql"
$dataDir = Join-Path $root "pgdata"
$logFile = Join-Path $dataDir "pg.log"

Write-Output "=================================================="
Write-Output "Setting up local portable PostgreSQL..."
Write-Output "=================================================="

# 1. Download and Extract
if (!(Test-Path $pgsqlDir)) {
    Write-Output "Downloading PostgreSQL 16.2 zip from EDB..."
    # Use curl.exe directly as it shows progress and is faster on Windows
    curl.exe -L -o $zipFile $zipUrl
    
    Write-Output "Extracting binaries to $pgsqlDir using tar.exe..."
    & tar.exe -xf $zipFile -C $root
    
    Write-Output "Cleaning up zip file..."
    if (Test-Path $zipFile) { Remove-Item $zipFile -Force }
} else {
    Write-Output "PostgreSQL binaries directory already exists."
}

$initdb = Join-Path $pgsqlDir "bin\initdb.exe"
$pgctl = Join-Path $pgsqlDir "bin\pg_ctl.exe"
$createdb = Join-Path $pgsqlDir "bin\createdb.exe"

# 2. Initialize Database Data Folder
if (!(Test-Path (Join-Path $dataDir "PG_VERSION"))) {
    Write-Output "Initializing data directory at $dataDir..."
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    
    # Run initdb: trust local and host connections, set username to postgres
    & $initdb -D $dataDir -U postgres --auth-local=trust --auth-host=trust
} else {
    Write-Output "PostgreSQL data directory is already initialized."
}

# 3. Start PostgreSQL Service (User Process)
Write-Output "Checking if PostgreSQL is already running..."
$listener = Get-NetTCPConnection -LocalPort 5432 -ErrorAction SilentlyContinue
if ($listener) {
    Write-Output "Port 5432 is already listening. Assuming Postgres or another database is running."
} else {
    Write-Output "Starting PostgreSQL on port 5432..."
    # Start pg_ctl in background and write to log file
    & $pgctl -D $dataDir -l $logFile -o "-F -p 5432" start
    
    # Bounded wait for startup
    Start-Sleep -Seconds 5
}

# 4. Create Database
Write-Output "Creating database 'hevea_partners'..."
try {
    # Check if database exists by trying to connect
    $env:PGPASSWORD = ""
    & (Join-Path $pgsqlDir "bin\psql.exe") -U postgres -p 5432 -d template1 -c "SELECT 1 FROM pg_database WHERE datname='hevea_partners'" -t | Out-String
    
    # If it fails or returns empty, we create it
    # We run createdb and catch error if it already exists
    & $createdb -U postgres -p 5432 hevea_partners -E UTF8
    Write-Output "Database 'hevea_partners' created successfully."
} catch {
    Write-Output "Database 'hevea_partners' already exists or creation skipped."
}

Write-Output "=================================================="
Write-Output "PostgreSQL setup complete!"
Write-Output "=================================================="
