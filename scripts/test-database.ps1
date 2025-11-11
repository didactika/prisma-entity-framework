#!/usr/bin/env pwsh
# Unified test script for any database
# Usage: .\test-database.ps1 -Database <mysql|postgresql|mongodb|sqlite>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('mysql', 'postgresql', 'mongodb', 'sqlite')]
    [string]$Database
)

# Global error handling
$ErrorActionPreference = "Stop"
$script:cleanupRequired = $false
$script:containerStarted = $false

function Write-Log {
    param(
        [string]$Message,
        [ValidateSet('Info', 'Success', 'Warning', 'Error')]
        [string]$Level = 'Info'
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Level) {
        'Info'    { 'Cyan' }
        'Success' { 'Green' }
        'Warning' { 'Yellow' }
        'Error'   { 'Red' }
    }
    
    $prefix = switch ($Level) {
        'Info'    { '[INFO]' }
        'Success' { '[SUCCESS]' }
        'Warning' { '[WARNING]' }
        'Error'   { '[ERROR]' }
    }
    
    Write-Host "$timestamp $prefix $Message" -ForegroundColor $color
}

function Invoke-Cleanup {
    param(
        [string]$Database,
        [bool]$Force = $false
    )
    
    if (-not $script:cleanupRequired -and -not $Force) {
        return
    }
    
    Write-Log "Performing cleanup for $Database..." -Level Warning
    
    try {
        # Disconnect any active connections
        if ($Database -ne 'sqlite') {
            Write-Log "Stopping $Database container..." -Level Info
            docker-compose stop $Database 2>&1 | Out-Null
            
            if ($Force) {
                Write-Log "Removing $Database container..." -Level Info
                docker-compose rm -f $Database 2>&1 | Out-Null
            }
        }
        
        # Clean up SQLite database file if it exists
        if ($Database -eq 'sqlite') {
            $sqliteFile = "test.db"
            if (Test-Path $sqliteFile) {
                Remove-Item $sqliteFile -Force -ErrorAction SilentlyContinue
                Write-Log "Removed SQLite database file" -Level Info
            }
        }
        
        Write-Log "Cleanup completed" -Level Success
    } catch {
        Write-Log "Cleanup encountered an error: $_" -Level Warning
    }
}

function Wait-ForDatabase {
    param(
        [string]$Database,
        [int]$MaxAttempts = 30,
        [int]$RetryDelaySeconds = 2
    )
    
    Write-Log "Waiting for $Database to be ready (max $MaxAttempts attempts)..." -Level Info
    $attempt = 0
    $ready = $false
    $lastError = $null
    
    # Save and change error action preference for database checks
    $prevErrorAction = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    while (-not $ready -and $attempt -lt $MaxAttempts) {
        $attempt++
        try {
            switch ($Database) {
                'mysql' {
                    $result = docker-compose exec -T mysql mysqladmin ping -h localhost -u root -pprisma_test_password 2>&1
                    # MySQL outputs warning to stderr but succeeds with exit code 0
                    # Check both exit code and output for "mysqld is alive"
                    if ($LASTEXITCODE -eq 0 -and $result -match "mysqld is alive") {
                        $ready = $true
                    } else {
                        $lastError = "MySQL ping failed with exit code $LASTEXITCODE"
                    }
                }
                'postgresql' {
                    $result = docker-compose exec -T postgresql pg_isready -U prisma_test 2>&1
                    if ($LASTEXITCODE -eq 0) {
                        $ready = $true
                    } else {
                        $lastError = "PostgreSQL readiness check failed with exit code $LASTEXITCODE"
                    }
                }
                'mongodb' {
                    $result = docker-compose exec -T mongodb mongosh --quiet --eval "db.adminCommand('ping').ok" 2>&1
                    if ($LASTEXITCODE -eq 0 -and $result -match "1") {
                        $ready = $true
                    } else {
                        $lastError = "MongoDB ping failed"
                    }
                }
            }
        } catch {
            $lastError = $_.Exception.Message
        }
        
        if (-not $ready) {
            if ($attempt % 5 -eq 0) {
                Write-Host ""
                Write-Log "Still waiting... (attempt $attempt/$MaxAttempts)" -Level Warning
            } else {
                Write-Host "." -NoNewline
            }
            Start-Sleep -Seconds $RetryDelaySeconds
        }
    }

    Write-Host ""
    
    # Restore error action preference
    $ErrorActionPreference = $prevErrorAction
    
    if (-not $ready) {
        Write-Log "$Database failed to start after $MaxAttempts attempts" -Level Error
        if ($lastError) {
            Write-Log "Last error: $lastError" -Level Error
        }
        throw "Database readiness check failed"
    }

    Write-Log "$Database is ready! (took $attempt attempts)" -Level Success
}

# Main execution
try {
    $startTime = Get-Date
    Write-Log "===============================================" -Level Info
    Write-Log "Starting $Database testing environment" -Level Info
    Write-Log "===============================================" -Level Info
    Write-Host ""

    if ($Database -ne 'sqlite') {
        # Start database container
        Write-Log "Starting $Database container..." -Level Info
        
        try {
            # Check if container is already running
            $containerName = "prisma-ef-$Database"
            $containerStatus = docker ps --filter "name=$containerName" --format "{{.Status}}" 2>&1
            
            if ($containerStatus -and $containerStatus -match "Up") {
                Write-Log "Container already running, reusing existing container" -Level Info
                $script:containerStarted = $false  # Don't stop it in cleanup
                $script:cleanupRequired = $false
            } else {
                docker-compose up -d $Database 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    throw "Failed to start $Database container (exit code: $LASTEXITCODE)"
                }
                $script:containerStarted = $true
                $script:cleanupRequired = $true
                Write-Log "Container started successfully" -Level Success
            }
        } catch {
            Write-Log "Failed to start container: $_" -Level Error
            throw
        }

        # Wait for database to be ready with retry logic
        try {
            Wait-ForDatabase -Database $Database -MaxAttempts 30 -RetryDelaySeconds 2
        } catch {
            Write-Log "Database readiness check failed" -Level Error
            throw
        }

        # Set environment variables (before replica set init for MongoDB)
        Write-Log "Configuring environment variables..." -Level Info
        switch ($Database) {
            'mysql' {
                $env:DATABASE_URL = "mysql://prisma_test:prisma_test_password@localhost:3311/prisma_test"
            }
            'postgresql' {
                $env:DATABASE_URL = "postgresql://prisma_test:prisma_test_password@localhost:5433/prisma_test"
            }
            'mongodb' {
                # Use directConnection without replicaSet for initialization
                $env:DATABASE_URL = "mongodb://localhost:27020/prisma_test?directConnection=true"
                $env:DATABASE_URL_MONGODB = $env:DATABASE_URL
            }
        }
        Write-Log "Environment configured for $Database" -Level Success

        # Initialize MongoDB replica set if needed
        if ($Database -eq 'mongodb') {
            Write-Log "Initializing MongoDB replica set..." -Level Info
            try {
                # Try to get replica set status
                $prevErrorAction = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                $rsStatus = docker-compose exec -T mongodb mongosh --quiet --eval "try { rs.status().ok } catch(e) { 0 }" 2>&1
                $ErrorActionPreference = $prevErrorAction
                
                # Check if we got a valid response indicating replica set is initialized
                if ($rsStatus -match "1") {
                    Write-Log "Replica set already initialized" -Level Info
                } else {
                    Write-Log "Initializing replica set rs0..." -Level Info
                    
                    # Initialize replica set
                    $ErrorActionPreference = "Continue"
                    $initResult = docker-compose exec -T mongodb mongosh --quiet --eval "rs.initiate({_id: 'rs0', members: [{_id: 0, host: 'localhost:27017'}]})" 2>&1
                    $initExitCode = $LASTEXITCODE
                    $ErrorActionPreference = $prevErrorAction
                    
                    if ($initExitCode -eq 0 -or $initResult -match "ok.*1" -or $initResult -match "already initialized") {
                        Write-Log "Replica set initialized successfully" -Level Success
                        
                        # Wait for replica set to become primary
                        Write-Log "Waiting for replica set to become primary..." -Level Info
                        $maxWait = 15
                        $waited = 0
                        $isPrimary = $false
                        
                        while ($waited -lt $maxWait -and -not $isPrimary) {
                            Start-Sleep -Seconds 1
                            $waited++
                            
                            $ErrorActionPreference = "Continue"
                            $primaryCheck = docker-compose exec -T mongodb mongosh --quiet --eval "db.hello().isWritablePrimary" 2>&1
                            $ErrorActionPreference = $prevErrorAction
                            
                            if ($primaryCheck -match "true") {
                                $isPrimary = $true
                                Write-Log "Replica set is now primary" -Level Success
                            }
                        }
                        
                        if (-not $isPrimary) {
                            Write-Log "Replica set did not become primary within ${maxWait}s, but continuing..." -Level Warning
                        }
                    } else {
                        Write-Log "Replica set initialization output: $initResult" -Level Warning
                        Write-Log "Continuing anyway..." -Level Info
                    }
                }
                
                # Update connection string to include replicaSet after initialization
                $env:DATABASE_URL = "mongodb://localhost:27020/prisma_test?directConnection=true&replicaSet=rs0"
                $env:DATABASE_URL_MONGODB = $env:DATABASE_URL
                Write-Log "Updated MongoDB connection string with replica set" -Level Info
            } catch {
                Write-Log "Replica set initialization encountered an issue: $_" -Level Warning
                Write-Log "Continuing with basic connection string..." -Level Info
            }
        }

        # Generate Prisma client
        Write-Log "Generating Prisma client for $Database..." -Level Info
        $prevErrorAction = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $output = npx prisma generate --schema="tests/prisma/schema.$Database.prisma" 2>&1
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $prevErrorAction
        if ($exitCode -ne 0) {
            Write-Log "Prisma generate output: $output" -Level Error
            Write-Log "Failed to generate Prisma client (exit code: $exitCode)" -Level Error
            throw "Prisma generate failed"
        }
        Write-Log "Prisma client generated successfully" -Level Success

        # Push schema to database
        Write-Log "Pushing schema to $Database..." -Level Info
        $ErrorActionPreference = "Continue"
        if ($Database -eq 'mongodb') {
            $output = npx prisma db push --schema="tests/prisma/schema.$Database.prisma" --skip-generate --accept-data-loss 2>&1
        } else {
            $output = npx prisma db push --schema="tests/prisma/schema.$Database.prisma" --skip-generate 2>&1
        }
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $prevErrorAction
        
        if ($exitCode -ne 0) {
            Write-Log "Schema push output: $output" -Level Error
            Write-Log "Failed to push schema (exit code: $exitCode)" -Level Error
            throw "Schema push failed"
        }
        Write-Log "Schema pushed successfully" -Level Success
    } else {
        Write-Log "Using SQLite (no container required)" -Level Info
        $env:DATABASE_URL = "file:./test.db"
        
        # Generate Prisma client for SQLite
        Write-Log "Generating Prisma client for SQLite..." -Level Info
        $prevErrorAction = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $output = npx prisma generate --schema="tests/prisma/schema.test.prisma" 2>&1
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $prevErrorAction
        if ($exitCode -ne 0) {
            Write-Log "Prisma generate output: $output" -Level Error
            Write-Log "Failed to generate Prisma client (exit code: $exitCode)" -Level Error
            throw "Prisma generate failed"
        }
        Write-Log "Prisma client generated successfully" -Level Success
        
        # Push schema for SQLite
        Write-Log "Pushing schema to SQLite..." -Level Info
        $ErrorActionPreference = "Continue"
        $output = npx prisma db push --schema="tests/prisma/schema.test.prisma" --skip-generate 2>&1
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $prevErrorAction
        if ($exitCode -ne 0) {
            Write-Log "Schema push output: $output" -Level Error
            Write-Log "Failed to push schema (exit code: $exitCode)" -Level Error
            throw "Schema push failed"
        }
        Write-Log "Schema pushed successfully" -Level Success
    }

    Write-Host ""
    Write-Log "===============================================" -Level Info
    Write-Log "Running integration tests" -Level Info
    Write-Log "===============================================" -Level Info
    Write-Host ""

    # Run tests
    $env:SKIP_SCHEMA_PUSH = "true"
    $testStartTime = Get-Date
    
    npx jest integration --runInBand
    $testExitCode = $LASTEXITCODE
    
    $testEndTime = Get-Date
    $testDuration = ($testEndTime - $testStartTime).TotalSeconds

    Write-Host ""
    Write-Log "===============================================" -Level Info
    Write-Log "Test Execution Summary" -Level Info
    Write-Log "===============================================" -Level Info
    Write-Log "Database: $Database" -Level Info
    Write-Log "Test Duration: $([math]::Round($testDuration, 2)) seconds" -Level Info
    
    if ($testExitCode -eq 0) {
        Write-Log "Test Result: PASSED" -Level Success
    } else {
        Write-Log "Test Result: FAILED (exit code: $testExitCode)" -Level Error
    }
    
    $endTime = Get-Date
    $totalDuration = ($endTime - $startTime).TotalSeconds
    Write-Log "Total Duration: $([math]::Round($totalDuration, 2)) seconds" -Level Info
    Write-Log "===============================================" -Level Info
    Write-Host ""

    # Cleanup on success
    if ($testExitCode -eq 0) {
        Invoke-Cleanup -Database $Database
    }

    exit $testExitCode

} catch {
    Write-Host ""
    Write-Log "===============================================" -Level Error
    Write-Log "FATAL ERROR" -Level Error
    Write-Log "===============================================" -Level Error
    Write-Log "An error occurred during test execution:" -Level Error
    Write-Log "$_" -Level Error
    Write-Log "Stack Trace:" -Level Error
    Write-Log "$($_.ScriptStackTrace)" -Level Error
    Write-Host ""
    
    # Cleanup on failure
    Invoke-Cleanup -Database $Database -Force $true
    
    exit 1
} finally {
    # Ensure cleanup happens even on unexpected termination
    if ($script:cleanupRequired) {
        Write-Log "Ensuring cleanup is performed..." -Level Warning
        Invoke-Cleanup -Database $Database
    }
}
