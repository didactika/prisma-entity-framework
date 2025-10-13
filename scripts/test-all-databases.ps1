#!/usr/bin/env pwsh
# Test script to run tests on all supported databases
# Prerequisites: Docker must be running

Write-Host "Starting comprehensive database testing..." -ForegroundColor Cyan
Write-Host ""

$failed = $false

# Test with SQLite (default)
Write-Host "===============================================" -ForegroundColor Blue
Write-Host "Testing with SQLite (default)" -ForegroundColor Blue
Write-Host "===============================================" -ForegroundColor Blue
npm test
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] SQLite tests failed" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "[SUCCESS] SQLite tests passed" -ForegroundColor Green
}
Write-Host ""

# Test with MySQL
Write-Host "===============================================" -ForegroundColor Blue
Write-Host "Testing with MySQL" -ForegroundColor Blue
Write-Host "===============================================" -ForegroundColor Blue
& "$PSScriptRoot\test-mysql.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] MySQL tests failed" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "[SUCCESS] MySQL tests passed" -ForegroundColor Green
}
Write-Host ""

# Test with PostgreSQL
Write-Host "===============================================" -ForegroundColor Blue
Write-Host "Testing with PostgreSQL" -ForegroundColor Blue
Write-Host "===============================================" -ForegroundColor Blue
& "$PSScriptRoot\test-postgresql.ps1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] PostgreSQL tests failed" -ForegroundColor Red
    $failed = $true
} else {
    Write-Host "[SUCCESS] PostgreSQL tests passed" -ForegroundColor Green
}
Write-Host ""

# Summary
Write-Host "===============================================" -ForegroundColor Blue
Write-Host "Test Summary" -ForegroundColor Blue
Write-Host "===============================================" -ForegroundColor Blue

if ($failed) {
    Write-Host "[ERROR] Some tests failed" -ForegroundColor Red
    exit 1
} else {
    Write-Host "[SUCCESS] All database tests passed!" -ForegroundColor Green
    exit 0
}
