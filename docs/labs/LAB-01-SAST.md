# Lab 1: SAST - Find and Fix Vulnerabilities in Code

**Duration:** 20 minutes
**Tools:** Semgrep, SpotBugs (Java), ESLint Security (Node)

---

## Objective

You will:
1. Review intentionally vulnerable code (Java + Node.js)
2. Run SAST tools to detect the vulnerabilities
3. Fix each vulnerability
4. Re-run the tools to confirm fixes

---

## Setup

```bash
# Install Semgrep (if not already installed)
pip install semgrep
# OR
brew install semgrep
```

---

## Part A: Java Vulnerabilities

### Step 1: Review the Vulnerable Code

Open and read `docs/labs/vulnerable-samples/VulnerableOrderController.java`

This controller has **5 security vulnerabilities**. Can you spot them all before running the scanner?

Take 3 minutes to review, then continue.

### Step 2: Run Semgrep

```bash
# From the project root
semgrep --config auto --config p/owasp-top-ten \
    docs/labs/vulnerable-samples/VulnerableOrderController.java
```

**Expected output:** Semgrep should find 3-5 issues.

### Step 3: Run SpotBugs

```bash
# Copy the vulnerable file temporarily into the project
cp docs/labs/vulnerable-samples/VulnerableOrderController.java \
   order-service/src/main/java/com/example/order/controller/VulnerableOrderController.java

cd order-service
mvn compile
mvn spotbugs:check

# Clean up
rm src/main/java/com/example/order/controller/VulnerableOrderController.java
```

### Step 4: Fix the Vulnerabilities

Open `docs/labs/vulnerable-samples/VulnerableOrderController.java` and fix each issue. The vulnerabilities are:

| # | Vulnerability | Line Hint | CWE |
|---|--------------|-----------|-----|
| 1 | SQL Injection | `searchOrders` method | CWE-89 |
| 2 | Hardcoded password | `DB_PASSWORD` constant | CWE-798 |
| 3 | Log injection | `log.info` with user input | CWE-117 |
| 4 | Insecure deserialization | `ObjectInputStream` | CWE-502 |
| 5 | Missing input validation | `createOrder` method | CWE-20 |

**Hints for fixes:**
1. Use `PreparedStatement` or JPA parameterized query
2. Use `@Value("${db.password}")` to read from environment
3. Sanitize user input before logging (remove newlines)
4. Use Jackson `ObjectMapper` instead of Java serialization
5. Add `@Valid` annotation and bean validation

### Step 5: Verify Fixes

```bash
semgrep --config auto --config p/owasp-top-ten \
    docs/labs/vulnerable-samples/VulnerableOrderController.java

# Expected: 0 findings (or significantly fewer)
```

---

## Part B: Node.js Vulnerabilities

### Step 1: Review the Vulnerable Code

Open and read `docs/labs/vulnerable-samples/vulnerableProductRoutes.js`

This Express router has **5 security vulnerabilities**.

### Step 2: Run Semgrep

```bash
semgrep --config auto --config p/owasp-top-ten \
    docs/labs/vulnerable-samples/vulnerableProductRoutes.js
```

### Step 3: Run ESLint

```bash
cd product-service
npx eslint ../docs/labs/vulnerable-samples/vulnerableProductRoutes.js
```

### Step 4: Fix the Vulnerabilities

| # | Vulnerability | Line Hint | CWE |
|---|--------------|-----------|-----|
| 1 | Command injection | `exec()` call | CWE-78 |
| 2 | eval() with user input | `calculate` route | CWE-94 |
| 3 | Path traversal | `download` route | CWE-22 |
| 4 | XSS (reflected) | `search` route | CWE-79 |
| 5 | NoSQL injection | `findProduct` method | CWE-943 |

### Step 5: Verify Fixes

```bash
semgrep --config auto docs/labs/vulnerable-samples/vulnerableProductRoutes.js
npx eslint docs/labs/vulnerable-samples/vulnerableProductRoutes.js
```

---

## Bonus Challenge

Write a custom Semgrep rule that catches this pattern in your codebase:

```java
// Should be flagged:
response.setHeader("Access-Control-Allow-Origin", "*");

// Should NOT be flagged:
response.setHeader("Access-Control-Allow-Origin", "https://myapp.com");
```

Create a file `my-custom-rule.yml`:
```yaml
rules:
  - id: cors-wildcard
    pattern: |
      $RESPONSE.setHeader("Access-Control-Allow-Origin", "*")
    message: "CORS wildcard allows any origin. Specify allowed origins explicitly."
    languages: [java]
    severity: WARNING
```

Test it:
```bash
semgrep --config my-custom-rule.yml order-service/
```
