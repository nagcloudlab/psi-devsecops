# Lab 4: DAST - Scan a Running Application with OWASP ZAP

**Duration:** 20 minutes
**Tools:** OWASP ZAP (via Docker), curl

---

## Objective

You will:
1. Start the product-service locally
2. Run OWASP ZAP baseline scan against it
3. Analyze the findings
4. Fix security issues and re-scan
5. Compare before/after results

---

## Setup

Make sure Docker is running.

---

## Part A: Start the Application

### Step 1: Start product-service

```bash
cd product-service
npm ci
npm start &

# Verify it's running
curl http://localhost:3000/health
# Expected: {"status":"UP","service":"product-service"}
```

### Step 2: Test the API

```bash
# List products
curl http://localhost:3000/api/products

# Get a specific product
curl http://localhost:3000/api/products/p1

# Create a product
curl -X POST http://localhost:3000/api/products \
    -H "Content-Type: application/json" \
    -d '{"name":"Monitor","price":299.99,"stock":30}'
```

---

## Part B: Run ZAP Baseline Scan

### Step 1: Run ZAP

```bash
# From the project root
docker run --rm --network host \
    -v $(pwd)/reports:/zap/wrk \
    zaproxy/zap-stable zap-baseline.py \
    -t http://localhost:3000 \
    -r zap-baseline-report.html \
    -J zap-baseline-report.json \
    -a
```

**This will take ~2 minutes.** ZAP will:
1. Spider the application (discover URLs)
2. Send requests to each URL
3. Analyze responses for security issues

### Step 2: View the Report

```bash
open reports/zap-baseline-report.html
```

### Step 3: Analyze Findings

**Typical baseline findings for our product-service:**

| Alert | Risk | Description |
|-------|------|-------------|
| Content-Security-Policy Header Not Set | Medium | No CSP header |
| Missing Anti-Clickjacking Header | Medium | No X-Frame-Options |
| X-Content-Type-Options Header Missing | Low | No nosniff header |
| Server Leaks Information | Low | Server header reveals tech |

**Wait** - our product-service uses `helmet`. Let's check...

```bash
# Check response headers
curl -I http://localhost:3000/api/products
```

If `helmet` is working, you should see:
```
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
Content-Security-Policy: default-src 'self'
X-XSS-Protection: 0
```

**Question:** If helmet is adding these headers, why might ZAP still report issues?
(Hint: Check if specific routes or error responses are missing headers)

---

## Part C: Test Without Security Middleware

### Step 1: Create a Vulnerable Version

Create a file `product-service/src/insecure-server.js`:

```javascript
const express = require('express');
const app = express();

// NO helmet - no security headers
// NO rate limiting
// NO input validation
app.use(express.json());

app.get('/api/products', (req, res) => {
    res.json([{ id: 1, name: 'Test', price: 9.99 }]);
});

// Vulnerable: reflects user input in HTML
app.get('/search', (req, res) => {
    res.send(`<html><body>Results for: ${req.query.q}</body></html>`);
});

// Vulnerable: detailed error messages
app.use((err, req, res, next) => {
    res.status(500).json({
        error: err.message,
        stack: err.stack     // NEVER expose stack traces!
    });
});

app.listen(3001, () => console.log('Insecure server on :3001'));
```

### Step 2: Start the Insecure Version

```bash
node product-service/src/insecure-server.js &
```

### Step 3: Scan the Insecure Version

```bash
docker run --rm --network host \
    -v $(pwd)/reports:/zap/wrk \
    zaproxy/zap-stable zap-baseline.py \
    -t http://localhost:3001 \
    -r zap-insecure-report.html \
    -a
```

### Step 4: Compare Reports

```bash
open reports/zap-baseline-report.html       # Secure (with helmet)
open reports/zap-insecure-report.html       # Insecure (without helmet)
```

**Expected:** The insecure version has significantly more findings, especially:
- Missing security headers (5-10 more alerts)
- XSS on the `/search` endpoint
- Information disclosure in error responses

---

## Part D: Using ZAP Rules File

### Step 1: View Our Rules

```bash
cat security-config/zap-rules.tsv
```

### Step 2: Run with Rules

```bash
docker run --rm --network host \
    -v $(pwd)/reports:/zap/wrk \
    -v $(pwd)/security-config/zap-rules.tsv:/zap/rules.tsv \
    zaproxy/zap-stable zap-baseline.py \
    -t http://localhost:3000 \
    -c rules.tsv \
    -r zap-with-rules-report.html \
    -a
```

**Compare:** With the rules file, some alerts are now FAIL (pipeline blockers) while others are WARN or IGNORE.

---

## Part E: ZAP API Scan (Bonus)

If your service has an OpenAPI/Swagger spec:

```bash
# If using springdoc-openapi (Java):
docker run --rm --network host \
    zaproxy/zap-stable zap-api-scan.py \
    -t http://localhost:8080/v3/api-docs \
    -f openapi \
    -r zap-api-report.html
```

---

## Cleanup

```bash
# Stop the servers
kill %1 %2 2>/dev/null
rm -f product-service/src/insecure-server.js
rm -f reports/zap-insecure-report.*
```

---

## Key Takeaways

1. **Baseline scan** is quick (~2 min) and catches configuration issues - run on every deploy
2. **Security headers** (helmet/Spring Security) eliminate many DAST findings
3. **Error handling** should never expose stack traces or internal details
4. **Rules files** let you customize which findings block the pipeline
5. **Always compare** with vs without security measures to see the impact
