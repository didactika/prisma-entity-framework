#!/usr/bin/env pwsh
# Test script for MySQL database
# Prerequisites: Docker must be running

Write-Host "Starting MySQL testing environment..." -ForegroundColor Cyan

# Start MySQL container
Write-Host "Starting MySQL container..." -ForegroundColor Yellow
docker-compose up -d mysql

# Wait for MySQL to be ready
Write-Host "Waiting for MySQL to be ready..." -ForegroundColor Yellow
$maxAttempts = 30
$attempt = 0
$ready = $false

while (-not $ready -and $attempt -lt $maxAttempts) {
    $attempt++
    try {
        docker-compose exec -T mysql mysqladmin ping -h localhost -u root -pprisma_test_password 2>&1 | Out-Null
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
    Write-Host "[ERROR] MySQL failed to start after 30 seconds" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[SUCCESS] MySQL is ready!" -ForegroundColor Green

# Generate Prisma client for MySQL
Write-Host "Generating Prisma client for MySQL..." -ForegroundColor Yellow
$env:DATABASE_URL = "mysql://prisma_test:prisma_test_password@localhost:3311/prisma_test"
npx prisma generate --schema=tests/prisma/schema.mysql.prisma

# Push schema to database
Write-Host "Pushing schema to MySQL..." -ForegroundColor Yellow
npx prisma db push --schema=tests/prisma/schema.mysql.prisma --skip-generate

# Run tests
Write-Host "Running tests with MySQL..." -ForegroundColor Yellow
npm test

Write-Host "[COMPLETED] MySQL testing completed!" -ForegroundColor Green
