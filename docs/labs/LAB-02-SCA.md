# Lab 2: SCA - Find Vulnerable Dependencies

**Duration:** 15 minutes
**Tools:** OWASP Dependency-Check, npm audit, Trivy

---

## Objective

You will:
1. Introduce a known-vulnerable dependency to each service
2. Run SCA tools to detect it
3. Fix the dependency
4. Understand how to read SCA reports

---

## Part A: Java - Introduce a Vulnerable Dependency

### Step 1: Add a Vulnerable Library

Edit `order-service/pom.xml` and add this dependency (a version with a known critical CVE):

```xml
<dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
    <version>2.9.8</version> <!-- Known vulnerable version - multiple CVEs -->
</dependency>
```

### Step 2: Run OWASP Dependency-Check

```bash
cd order-service
mvn org.owasp:dependency-check-maven:check
```

**Wait for it to complete** (first run downloads the NVD database, takes 2-5 minutes).

### Step 3: View the Report

```bash
open target/dependency-check-report.html
```

**Questions to answer:**
1. How many CVEs were found for jackson-databind 2.9.8?
2. What is the highest CVSS score?
3. What version fixes the issues?
4. Did the build FAIL? (Check `failBuildOnCVSS` in pom.xml)

### Step 4: Run Trivy as Cross-Validation

```bash
trivy fs --severity HIGH,CRITICAL order-service/
```

**Compare:** Did Trivy find the same CVEs? Did it find additional ones?

### Step 5: Fix It

Remove the vulnerable version (Spring Boot's dependency management will use a safe version):

```xml
<!-- Remove the explicit version to use Spring Boot's managed version -->
<!-- Or update to the latest: -->
<dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
    <version>2.17.0</version>
</dependency>
```

Re-run: `mvn org.owasp:dependency-check-maven:check`

---

## Part B: Node.js - Introduce a Vulnerable Dependency

### Step 1: Add a Vulnerable Package

```bash
cd product-service

# Install an old, vulnerable version of a common package
npm install lodash@4.17.15
```

lodash 4.17.15 has known prototype pollution vulnerabilities (CVE-2020-8203, CVE-2021-23337).

### Step 2: Run npm audit

```bash
npm audit
```

**Questions to answer:**
1. What severity is the finding?
2. What is the CVE number?
3. What version is the fix?

### Step 3: Run Trivy

```bash
trivy fs --severity HIGH,CRITICAL .
```

### Step 4: Fix It

```bash
# Option A: Auto-fix
npm audit fix

# Option B: Manual update
npm install lodash@latest

# Option C: If it's a transitive dependency you don't directly use
npm uninstall lodash
```

### Step 5: Verify

```bash
npm audit
# Expected: 0 vulnerabilities
```

---

## Part C: Understanding the Dependency Tree

### Java

```bash
cd order-service

# See all dependencies (including transitive)
mvn dependency:tree

# See only dependencies with known issues
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
```

**Exercise:** Find which Spring Boot starter pulls in Jackson. Is it a direct or transitive dependency?

### Node.js

```bash
cd product-service

# See dependency tree
npm ls

# See why a specific package is installed
npm explain lodash

# See only production dependencies
npm ls --production
```

---

## Bonus: Generate an SBOM

```bash
# Using Trivy
trivy fs --format spdx-json --output sbom-order.json order-service/
trivy fs --format spdx-json --output sbom-product.json product-service/

# View package count
cat sbom-order.json | python3 -m json.tool | grep -c '"name"'
```

**Question:** How many total packages (direct + transitive) does each service have?
