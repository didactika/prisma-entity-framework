# Expected Test Errors

When running the test suite for Prisma Entity Framework, you will see several error messages logged to the console, even if all tests pass. This is normal and expected.

Our test suite is designed to be robust and includes tests that verify the framework's error-handling capabilities. To do this, we intentionally trigger certain error conditions to ensure they are caught and handled correctly.

## Common Expected Errors

Here are some of the errors you can expect to see and why they are there:

### 1. Unique Constraint Failures

**Example Error:**
```
PrismaClientKnownRequestError: Unique constraint failed on the fields: (`email`)
```

**Why it happens:**
We have tests that validate the behavior of `createMany` with `skipDuplicates` and `upsertMany`. To test this, we intentionally try to insert data that violates unique constraints. The test passes if the framework correctly handles the error (e.g., by skipping the duplicate record).

### 2. Retry Logic Warnings

**Example Warning:**
```
Retrying operation... (attempt 2 of 3)
```

**Why it happens:**
The framework includes a `withRetry` utility to handle transient database errors. Our tests simulate these failures to ensure the retry logic is working as expected. You will see log messages indicating that a retry is being attempted.

### 3. Database Provider Detection Warnings

**Example Warning:**
```
Could not determine database provider from DATABASE_URL. Falling back to default.
```

**Why it happens:**
We test the framework's ability to function correctly even if it cannot automatically detect the database provider from the connection string. These tests intentionally use a generic or malformed `DATABASE_URL` to confirm that the system falls back to sensible defaults without crashing.

---

**Key Takeaway:** Don't be alarmed by red text in your test output! As long as the final Jest summary shows that all tests have **passed**, everything is working as intended.
