# Module 5: DAST - Dynamic Application Security Testing

---

## What is DAST?

DAST tests your **running application** by sending real HTTP requests and analyzing responses - like a hacker would, but automated.

**Analogy:**
- SAST = Reading the blueprint of a building and finding fire code violations
- DAST = Actually trying to break into the building to see if the locks work

```
                                   Your Running Application
                                   http://localhost:8080
                                          ^
                                          |
                                   HTTP Requests
                                          |
                              +-----------------------+
                              |     OWASP ZAP         |
                              |                       |
                              | 1. Spider/Crawl URLs  |
                              | 2. Send attack payloads|
                              | 3. Analyze responses  |
                              | 4. Report findings    |
                              +-----------------------+
                                          |
                                          v
                              "XSS found at /api/search?q=<script>"
                              "Missing security headers on /api/orders"
                              "SQL injection at /api/orders?sort=id;DROP"
```

**Key difference from SAST:** DAST doesn't look at source code. It treats the application as a "black box" and attacks it from the outside, just like a real attacker would.

---

## Why DAST Matters

DAST catches things that SAST cannot:

| SAST Can Find | DAST Can Find | Only DAST Can Find |
|---------------|---------------|-------------------|
| SQL injection in code | SQL injection at runtime | Missing HTTP security headers |
| XSS patterns | XSS actually executable | Server misconfiguration |
| Hardcoded secrets | | CORS misconfiguration |
| Insecure crypto usage | | Cookie security issues |
| | | Information leakage in error pages |
| | | SSL/TLS configuration issues |
| | | Authentication bypass |

### The Overlap is Valuable

```
SAST says: "Line 42 has a potential SQL injection"
Developer says: "But there's input validation at line 30 that prevents it"
SAST says: "I can't verify that"

DAST says: "I sent ' OR 1=1 -- to /api/orders?id= and got all records back"
Developer says: "Oh... the validation at line 30 only runs on POST, not GET"

DAST proves exploitability. SAST identifies potential risk.
```

---

## OWASP ZAP (Zed Attack Proxy)

### What is ZAP?

OWASP ZAP is the world's most popular free web application security scanner. It:
1. **Crawls** your application to discover all endpoints
2. **Passively** analyzes responses for security issues (headers, cookies, info leaks)
3. **Actively** sends attack payloads to find vulnerabilities (XSS, SQLi, etc.)

### ZAP Scan Types

| Scan Type | Speed | Depth | When to Use |
|-----------|-------|-------|-------------|
| **Baseline** | ~2 min | Passive only | Every PR / staging deploy |
| **Full Scan** | 30-60 min | Active attacks | Weekly / before production release |
| **API Scan** | 10-20 min | Active on API endpoints | When you have OpenAPI/Swagger spec |

```
Baseline Scan:
  - Spider the application (find URLs)
  - Check response headers
  - Check cookie settings
  - Check for information disclosure
  - Does NOT send attack payloads
  - Safe to run frequently

Full Scan:
  - Everything in Baseline PLUS:
  - SQL injection attempts
  - XSS injection attempts
  - Path traversal attempts
  - Command injection attempts
  - Takes much longer
  - Could generate many requests (test environment only!)

API Scan:
  - Reads your OpenAPI/Swagger definition
  - Tests each API endpoint with attack payloads
  - Understands request/response schemas
  - Targeted and efficient
```

---

## Running ZAP Locally

### Against our order-service (Spring Boot)

```bash
# Step 1: Start the application
cd order-service
mvn spring-boot:run &

# Step 2: Run ZAP baseline scan
docker run --rm --network host \
    zaproxy/zap-stable zap-baseline.py \
    -t http://localhost:8080 \
    -r zap-report.html

# Step 3: View the report
open zap-report.html
```

### Against our product-service (Express)

```bash
# Step 1: Start the application
cd product-service
npm start &

# Step 2: Run ZAP baseline scan
docker run --rm --network host \
    zaproxy/zap-stable zap-baseline.py \
    -t http://localhost:3000 \
    -r zap-report.html
```

### Full Scan (Active attacks - staging only!)

```bash
# WARNING: This sends actual attack payloads. Only run against YOUR test environment.
docker run --rm --network host \
    zaproxy/zap-stable zap-full-scan.py \
    -t http://localhost:8080 \
    -r zap-full-report.html
```

### API Scan (with OpenAPI spec)

```bash
# If your app serves an OpenAPI spec:
docker run --rm --network host \
    zaproxy/zap-stable zap-api-scan.py \
    -t http://localhost:8080/v3/api-docs \
    -f openapi \
    -r zap-api-report.html
```

---

## What ZAP Finds

### 1. Missing Security Headers

```
ALERT: Content-Security-Policy Header Not Set
Risk:  MEDIUM
URL:   http://localhost:8080/api/orders
```

**What this means:** Your server doesn't tell the browser to restrict what content can be loaded. An attacker could inject a script from an external domain.

**Fix for Spring Boot:**
```java
@Configuration
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.headers(headers -> headers
            .contentSecurityPolicy(csp ->
                csp.policyDirectives("default-src 'self'"))
            .frameOptions(frame -> frame.deny())
        );
        return http.build();
    }
}
```

**Fix for Express (already done in our product-service):**
```javascript
const helmet = require('helmet');
app.use(helmet());  // Sets 15+ security headers automatically
```

### 2. Missing Anti-Clickjacking Header

```
ALERT: Anti-clickjacking Header (X-Frame-Options) Missing
Risk:  MEDIUM
URL:   http://localhost:8080
```

**What this means:** Your page can be embedded in an iframe on a malicious site, enabling clickjacking attacks.

**Fix:** `helmet()` in Express sets this. In Spring Boot:
```java
headers.frameOptions(frame -> frame.deny());
```

### 3. Cookie Without Security Flags

```
ALERT: Cookie Without SameSite Attribute
Risk:  LOW
URL:   http://localhost:8080
Cookie: JSESSIONID=ABC123
```

**What this means:** The session cookie can be sent in cross-site requests, enabling CSRF attacks.

**Fix for Spring Boot:**
```yaml
# application.yml
server:
  servlet:
    session:
      cookie:
        same-site: strict
        http-only: true
        secure: true
```

### 4. Information Disclosure in Error Pages

```
ALERT: Application Error Disclosure
Risk:  MEDIUM
URL:   http://localhost:8080/api/orders/invalid
Evidence: "org.springframework.web.method.annotation.MethodArgumentTypeMismatchException"
```

**What this means:** Your error responses reveal internal implementation details (Spring class names, stack traces). Attackers use this to understand your tech stack.

**Fix for Spring Boot:**
```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> handleError(Exception e) {
        // Log the real error internally
        log.error("Internal error", e);
        // Return generic message to the client
        return ResponseEntity.status(500)
            .body(Map.of("error", "Internal server error"));
    }
}
```

**Fix for Express (already done in our product-service):**
```javascript
// Error handler that doesn't leak stack traces
app.use((err, req, res, next) => {
    console.error(err.stack);  // Log internally
    res.status(500).json({ error: 'Internal server error' });  // Generic response
});
```

### 5. SQL Injection (Full Scan Only)

```
ALERT: SQL Injection
Risk:  HIGH
URL:   http://localhost:8080/api/orders?sort=id%3BSELECT+*+FROM+users
Evidence: The response content was different when injecting SQL syntax
```

**What this means:** ZAP sent `sort=id;SELECT * FROM users` and got a different response than normal, indicating the SQL was interpreted.

### 6. Cross-Site Scripting (Full Scan Only)

```
ALERT: Cross Site Scripting (Reflected)
Risk:  HIGH
URL:   http://localhost:3000/api/products?search=<script>alert(1)</script>
Evidence: <script>alert(1)</script> found in response body
```

**What this means:** User input is reflected back in the response without escaping. An attacker can inject JavaScript.

---

## ZAP Rules Configuration

From our `security-config/zap-rules.tsv`:

```
10020  FAIL   (Anti-clickjacking Header)
10038  FAIL   (Content Security Policy Not Set)
40018  FAIL   (SQL Injection)
40012  FAIL   (XSS - Reflected)
10021  WARN   (X-Content-Type-Options Missing)
10010  IGNORE (Cookie No HttpOnly Flag)
```

**What this means:**
- `FAIL`: Pipeline stops. Must fix before deployment.
- `WARN`: Reported but pipeline continues. Fix in next sprint.
- `IGNORE`: Known false positive or accepted risk. Not reported.

---

## ZAP in Our Jenkins Pipeline

```groovy
stage('DAST - OWASP ZAP') {
    parallel {
        stage('ZAP - order-service') {
            steps {
                sh '''
                    docker run --rm --network host \
                        -v $(pwd)/reports:/zap/wrk \
                        -v $(pwd)/security-config/zap-rules.tsv:/zap/rules.tsv \
                        zaproxy/zap-stable zap-baseline.py \
                        -t http://localhost:8080 \
                        -c rules.tsv \
                        -J zap-order-report.json \
                        -r zap-order-report.html \
                        -a || true
                '''
            }
        }
        stage('ZAP - product-service') {
            steps {
                sh '''
                    docker run --rm --network host \
                        -v $(pwd)/reports:/zap/wrk \
                        -v $(pwd)/security-config/zap-rules.tsv:/zap/rules.tsv \
                        zaproxy/zap-stable zap-baseline.py \
                        -t http://localhost:3000 \
                        -c rules.tsv \
                        -J zap-product-report.json \
                        -r zap-product-report.html \
                        -a || true
                '''
            }
        }
    }
}
```

**Flags explained:**
- `--network host`: ZAP container can reach services on localhost
- `-c rules.tsv`: Custom rules defining FAIL/WARN/IGNORE thresholds
- `-J report.json`: JSON report for programmatic processing
- `-r report.html`: HTML report for human review (published in Jenkins)
- `-a`: Include all alerts (not just the first of each type)

---

## DAST Best Practices

| Practice | Why |
|----------|-----|
| Run baseline on every staging deploy | Quick passive checks, catches header issues |
| Run full scan weekly | Thorough active testing on a schedule |
| Never run active scans against production | Attack payloads could disrupt service |
| Use authenticated scanning | Test behind-login functionality too |
| Review reports weekly | DAST can generate many findings - prioritize |
| Start with baseline, graduate to full | Avoid being overwhelmed by findings |

### SAST vs DAST - Complementary, Not Competing

```
      SAST                          DAST
      ====                          ====
When: Build time                    After deployment
What: Source code                   Running application
How:  Pattern matching              HTTP attack simulation
Pros: Fast, early feedback          Finds runtime issues
Cons: False positives               Slower, needs running app
      Can't test runtime config     Can't pinpoint code line

              USE BOTH!
      SAST catches code-level issues early.
      DAST catches deployment/runtime issues later.
```

---

## Summary

```
DAST answers: "Can an attacker actually exploit my running application?"

  Tool: OWASP ZAP
    - Baseline scan: Passive checks (headers, cookies, info leaks) - fast
    - Full scan: Active attack payloads (SQLi, XSS, etc.) - thorough
    - API scan: Tests OpenAPI endpoints - targeted

  Pipeline:
    - Runs AFTER staging deployment (needs running application)
    - Scans both order-service (:8080) and product-service (:3000)
    - Uses custom rules.tsv to define FAIL/WARN/IGNORE thresholds

  Key findings:
    - Missing security headers (CSP, X-Frame-Options, HSTS)
    - Cookie security issues (SameSite, HttpOnly, Secure)
    - Information leakage in error responses
    - SQL injection / XSS (full scan)
```

**Next Module:** [05-CONTAINER-SECURITY.md](./05-CONTAINER-SECURITY.md)
