#!/usr/bin/env pwsh
# Unified test script for any database
# Usage: .\test-database.ps1 -Database <mysql|postgresql|mongodb|sqlite>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('mysql', 'postgresql', 'mongodb', 'sqlite')]
    [string]$Database
)

function Wait-ForDatabase {
    param(
        [string]$Database,
        [int]$MaxAttempts = 30
    )
    
    Write-Host "Waiting for $Database to be ready..." -ForegroundColor Yellow
    $attempt = 0
    $ready = $false

    while (-not $ready -and $attempt -lt $MaxAttempts) {
        $attempt++
        try {
            switch ($Database) {
                'mysql' {
                    docker-compose exec -T mysql mysqladmin ping -h localhost -u root -pprisma_test_password 2>&1 | Out-Null
                }
                'postgresql' {
                    docker-compose exec -T postgresql pg_isready -U prisma_test 2>&1 | Out-Null
                }
                'mongodb' {
                    docker-compose exec -T mongodb mongosh --eval "db.adminCommand('ping')" 2>&1 | Out-Null
                }
            }
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
        Write-Host "[ERROR] $Database failed to start after $MaxAttempts seconds" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "[SUCCESS] $Database is ready!" -ForegroundColor Green
}

# Main execution
Write-Host "Starting $Database testing environment..." -ForegroundColor Cyan

if ($Database -ne 'sqlite') {
    # Start database container
    Write-Host "Starting $Database container..." -ForegroundColor Yellow
    docker-compose up -d $Database

    # Wait for database to be ready
    Wait-ForDatabase -Database $Database

    # Generate Prisma client
    Write-Host "Generating Prisma client for $Database..." -ForegroundColor Yellow
    
    switch ($Database) {
        'mysql' {
            $env:DATABASE_URL = "mysql://prisma_test:prisma_test_password@localhost:3311/prisma_test"
        }
        'postgresql' {
            $env:DATABASE_URL = "postgresql://prisma_test:prisma_test_password@localhost:5433/prisma_test"
        }
        'mongodb' {
            $env:DATABASE_URL = "mongodb://localhost:27020/prisma_test?directConnection=true"
            $env:DATABASE_URL_MONGODB = $env:DATABASE_URL
        }
    }
    
    npx prisma generate --schema="tests/prisma/schema.$Database.prisma"

    # Push schema to database
    Write-Host "Pushing schema to $Database..." -ForegroundColor Yellow
    if ($Database -eq 'mongodb') {
        npx prisma db push --schema="tests/prisma/schema.$Database.prisma" --skip-generate --accept-data-loss
    } else {
        npx prisma db push --schema="tests/prisma/schema.$Database.prisma" --skip-generate
    }
}

# Run tests
Write-Host "Running tests with $Database..." -ForegroundColor Yellow

npx jest integration --runInBand

$testExitCode = $LASTEXITCODE

Write-Host "[COMPLETED] $Database testing completed!" -ForegroundColor Green

exit $testExitCode
