#!/usr/bin/env pwsh
# Test script for PostgreSQL database
# Prerequisites: Docker must be running

Write-Host "Starting PostgreSQL testing environment..." -ForegroundColor Cyan

# Start PostgreSQL container
Write-Host "Starting PostgreSQL container..." -ForegroundColor Yellow
docker-compose up -d postgresql

# Wait for PostgreSQL to be ready
Write-Host "Waiting for PostgreSQL to be ready..." -ForegroundColor Yellow
$maxAttempts = 30
$attempt = 0
$ready = $false

while (-not $ready -and $attempt -lt $maxAttempts) {
    $attempt++
    try {
        docker-compose exec -T postgresql pg_isready -U prisma_test 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
        }
    } catch {
        Start-Sleep -Seconds 1
    }
    
    if (-not $ready) {
        Write-Host "." -NoNewline
        Start-Sleep -Seconds 1
    }
}

if (-not $ready) {
    Write-Host ""
    Write-Host "[ERROR] PostgreSQL failed to start after 30 seconds" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[SUCCESS] PostgreSQL is ready!" -ForegroundColor Green

# Generate Prisma client for PostgreSQL
Write-Host "Generating Prisma client for PostgreSQL..." -ForegroundColor Yellow
$env:DATABASE_URL = "postgresql://prisma_test:prisma_test_password@localhost:5433/prisma_test"
npx prisma generate --schema=tests/prisma/schema.postgresql.prisma

# Push schema to database
Write-Host "Pushing schema to PostgreSQL..." -ForegroundColor Yellow
npx prisma db push --schema=tests/prisma/schema.postgresql.prisma --skip-generate

# Run tests
Write-Host "Running tests with PostgreSQL..." -ForegroundColor Yellow
npm test

Write-Host "[COMPLETED] PostgreSQL testing completed!" -ForegroundColor Green
