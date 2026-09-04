# Module 3: SCA - Software Composition Analysis

---

## What is SCA?

SCA scans **your dependencies** (libraries, frameworks, packages) for known vulnerabilities. It does NOT analyze your code - it checks if the third-party code you depend on has published CVEs.

**Analogy:** You build a house (your code). SAST checks if you wired the electricity correctly. SCA checks if the bricks you bought from the store have been recalled.

```
Your Application
+------------------------------------------+
|  Your Code (5-20%)     <-- SAST checks   |
|                                          |
|  Dependencies (80-95%) <-- SCA checks    |
|  +------------------------------------+  |
|  | spring-boot-starter-web   3.2.5    |  |
|  | spring-boot-starter-data-jpa       |  |
|  | h2database                         |  |
|  | jackson-databind          2.15.3   |  |
|  | express                   4.19.2   |  |
|  | helmet                    7.1.0    |  |
|  | uuid                      9.0.1    |  |
|  | ... and 200 more transitive deps   |  |
|  +------------------------------------+  |
+------------------------------------------+
```

**The scary truth:** 80-95% of your application code comes from open-source dependencies. If any of them has a vulnerability, your application is vulnerable too.

---

## Why SCA Matters: Real-World Incidents

### Case Study 1: Log4Shell (CVE-2021-44228)

```
Timeline:
  Nov 24, 2021  - Vulnerability reported to Apache
  Dec 9, 2021   - Public disclosure
  Dec 10, 2021  - Mass exploitation begins worldwide

  Organizations WITHOUT SCA:
  - "Wait, do we even use log4j?" (took days/weeks to figure out)
  - Had to manually check 500+ microservices
  - Some services were unknowingly vulnerable for months

  Organizations WITH SCA:
  - Ran: trivy fs . --severity CRITICAL
  - Instantly knew which services used log4j and which version
  - Patched within hours
```

**CVSS Score:** 10.0 (maximum). A single HTTP request could give an attacker remote code execution on your server.

### Case Study 2: event-stream (npm supply chain attack, 2018)

A popular npm package (`event-stream`, 2M weekly downloads) was taken over by a malicious maintainer who added code to steal cryptocurrency wallets.

**SCA with vulnerability databases would flag:** The compromised version had a new, suspicious dependency (`flatmap-stream`) that was later flagged.

---

## SCA Tools in Our Pipeline

| Tool | Ecosystem | How It Works | Output |
|------|-----------|-------------|--------|
| **OWASP Dependency-Check** | Java (Maven/Gradle) | Downloads NVD database, matches your JAR versions against known CVEs | HTML + JSON report |
| **npm audit** | Node.js (npm) | Queries npm advisory database for known vulnerabilities in `node_modules` | JSON report |
| **Trivy** | Both (any language) | Scans lockfiles, binaries, container images against multiple vuln DBs | JSON + Table report |

---

## Tool 1: OWASP Dependency-Check (Java)

### How It Works

```
1. Reads pom.xml / build.gradle
2. Identifies all dependencies (including transitive)
3. Downloads the National Vulnerability Database (NVD)
4. Matches each dependency version against known CVEs
5. Generates report with findings and CVSS scores
```

### Configuration in pom.xml

From our `order-service/pom.xml`:

```xml
<plugin>
    <groupId>org.owasp</groupId>
    <artifactId>dependency-check-maven</artifactId>
    <version>9.2.0</version>
    <configuration>
        <failBuildOnCVSS>7</failBuildOnCVSS>   <!-- Fail if CVSS >= 7.0 (High) -->
        <formats>
            <format>HTML</format>                <!-- Human-readable report -->
            <format>JSON</format>                <!-- Machine-readable for pipeline -->
        </formats>
    </configuration>
</plugin>
```

**Key setting:** `failBuildOnCVSS=7` means:
- CVSS 0-3.9 (Low): Reported but build passes
- CVSS 4.0-6.9 (Medium): Reported but build passes
- CVSS 7.0-8.9 (High): **Build FAILS**
- CVSS 9.0-10.0 (Critical): **Build FAILS**

### Running Locally

```bash
cd order-service

# Run dependency check
mvn org.owasp:dependency-check-maven:check

# View the HTML report
open target/dependency-check-report.html
```

### Understanding the Report

A typical finding looks like this:

```
+----------------------------------------------------------------------+
| Dependency: jackson-databind-2.15.3.jar                              |
+----------------------------------------------------------------------+
| CVE-2023-35116                                                        |
| CVSS Score: 7.5 (HIGH)                                               |
| Description: jackson-databind before 2.15.4 allows denial of service |
|              via a crafted JSON payload.                              |
| Fix: Upgrade to version 2.15.4 or later                              |
+----------------------------------------------------------------------+
```

**How to fix:**
```xml
<!-- In pom.xml, override the version -->
<dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
    <version>2.15.4</version>  <!-- Updated from 2.15.3 -->
</dependency>
```

### Transitive Dependencies - The Hidden Risk

Your `pom.xml` might list 5 dependencies. But each of those has its own dependencies:

```
spring-boot-starter-web (you declared this)
  +-- spring-web
  |     +-- spring-beans
  |     +-- spring-core
  +-- spring-webmvc
  |     +-- spring-expression
  +-- tomcat-embed-core          <-- Might have a CVE!
  |     +-- tomcat-annotations
  +-- jackson-databind           <-- Might have a CVE!
        +-- jackson-core
        +-- jackson-annotations
```

**You declared 1 dependency. Maven resolved 10+.** Any of these transitive dependencies could be vulnerable.

```bash
# See your full dependency tree
cd order-service
mvn dependency:tree
```

### OWASP Dependency-Check in Jenkins

```groovy
stage('OWASP Dependency-Check (Java)') {
    steps {
        dir('order-service') {
            sh 'mvn org.owasp:dependency-check-maven:check -B'
        }
    }
    post {
        always {
            dependencyCheckPublisher pattern: 'order-service/target/dependency-check-report.json'
            archiveArtifacts artifacts: 'order-service/target/dependency-check-report.*'
        }
    }
}
```

The `dependencyCheckPublisher` Jenkins plugin creates a dashboard showing:
- Number of vulnerabilities by severity
- Trend over time (are we getting better or worse?)
- Which dependencies are most problematic

---

## Tool 2: npm audit (Node.js)

### How It Works

```
1. Reads package-lock.json
2. Sends package list to npm advisory database
3. Returns known vulnerabilities for each package
4. Reports severity (low, moderate, high, critical)
```

### Running Locally

```bash
cd product-service

# Install dependencies first
npm ci

# Run audit
npm audit

# Output:
# ┌───────────────┬────────────────────────────────────────────┐
# │ High          │ Prototype Pollution in lodash               │
# ├───────────────┼────────────────────────────────────────────┤
# │ Package       │ lodash                                      │
# │ Dependency of │ express-validator                            │
# │ Path          │ express-validator > lodash                   │
# │ Fix           │ Upgrade to lodash@4.17.21                   │
# └───────────────┴────────────────────────────────────────────┘

# JSON output for CI
npm audit --json > npm-audit-report.json

# Fail only on critical
npm audit --audit-level=critical

# Fail on high and above
npm audit --audit-level=high

# Auto-fix what's possible
npm audit fix

# Force fix (may include breaking changes)
npm audit fix --force
```

### Audit Levels Explained

```
npm audit --audit-level=critical
                          ^
                          |
    Severity Scale:
    +-----------+-------+------+-----------+
    | low       | mod   | high | critical  |
    +-----------+-------+------+-----------+
                                     ^
                                     Only fails here

npm audit --audit-level=high
    +-----------+-------+------+-----------+
    | low       | mod   | high | critical  |
    +-----------+-------+------+-----------+
                           ^         ^
                           Fails on both
```

**Our pipeline uses:** `--audit-level=critical` for the blocking gate (must fix), and reports high for visibility.

### npm audit in Jenkins

```groovy
stage('npm Audit (Node)') {
    steps {
        dir('product-service') {
            sh '''
                npm audit --json > ../reports/npm-audit-report.json || true
                npm audit --audit-level=critical
            '''
        }
    }
}
```

- First command generates the full report (even if there are findings)
- Second command fails the build only on CRITICAL findings

---

## Tool 3: Trivy (Both Ecosystems)

### What is Trivy?

Trivy is a comprehensive vulnerability scanner by Aqua Security. It can scan:
- Filesystem (lock files, source code)
- Container images
- Kubernetes manifests
- Terraform/CloudFormation

### Why Trivy in Addition to OWASP Dep-Check and npm audit?

| Feature | OWASP Dep-Check | npm audit | Trivy |
|---------|----------------|-----------|-------|
| Java deps | Yes | No | Yes |
| Node deps | Limited | Yes | Yes |
| Python/Go/Ruby | No | No | Yes |
| Container OS pkgs | No | No | Yes |
| Misconfigurations | No | No | Yes |
| Secret scanning | No | No | Yes |
| Speed | Slow (downloads NVD) | Fast | Fast |

**Trivy covers gaps** between the ecosystem-specific tools and adds container scanning.

### Running Trivy Locally

```bash
# Install
brew install trivy

# Scan filesystem (finds vulnerable libraries)
trivy fs .
trivy fs order-service/
trivy fs product-service/

# Scan with severity filter
trivy fs --severity HIGH,CRITICAL .

# JSON output
trivy fs --format json --output trivy-report.json .

# Scan a Docker image
trivy image order-service:latest

# Scan and fail on critical
trivy fs --severity CRITICAL --exit-code 1 .
```

### Reading Trivy Output

```
product-service/package-lock.json (npm)
=======================================
Total: 3 (HIGH: 2, CRITICAL: 1)

+-----------------+------------------+----------+--------------------+---------------+
|     LIBRARY     | VULNERABILITY    | SEVERITY | INSTALLED VERSION  | FIXED VERSION |
+-----------------+------------------+----------+--------------------+---------------+
| express         | CVE-2024-XXXXX   | HIGH     | 4.18.2             | 4.19.2        |
| lodash          | CVE-2021-23337   | HIGH     | 4.17.20            | 4.17.21       |
| jsonwebtoken    | CVE-2022-23529   | CRITICAL | 8.5.1              | 9.0.0         |
+-----------------+------------------+----------+--------------------+---------------+
```

**How to read this:**
- `LIBRARY`: Which package has the vulnerability
- `VULNERABILITY`: The CVE identifier (look it up for full details)
- `SEVERITY`: How dangerous it is
- `INSTALLED VERSION`: What you currently have
- `FIXED VERSION`: What version fixes the issue - **this is your action item**

### Trivy in Jenkins

```groovy
stage('Trivy FS Scan') {
    steps {
        sh '''
            docker run --rm -v $(pwd):/repo \
                aquasec/trivy:latest fs /repo \
                --severity HIGH,CRITICAL \
                --format json \
                --output /repo/reports/trivy-fs-report.json
        '''
    }
}
```

---

## Fixing SCA Findings

### Java (Maven)

```bash
# See what's outdated
cd order-service
mvn versions:display-dependency-updates

# Update a specific dependency in pom.xml
# Change: <version>2.15.3</version>
# To:     <version>2.15.4</version>

# Update parent (Spring Boot)
# Change: <version>3.2.5</version>
# To:     <version>3.2.6</version>

# Verify nothing broke
mvn clean test
```

### Node.js (npm)

```bash
cd product-service

# See what's outdated
npm outdated

# Auto-fix vulnerabilities
npm audit fix

# Update a specific package
npm install express@latest

# Update all to latest minor/patch
npm update

# Check for breaking changes
npm test
```

### Suppressing False Positives

Sometimes a CVE exists but doesn't apply to your usage:

**OWASP Dependency-Check:**
Create a `suppression.xml`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<suppressions xmlns="https://jeremylong.github.io/DependencyCheck/dependency-suppression.1.3.xsd">
    <suppress>
        <notes>We don't use the XML parsing feature of this library</notes>
        <cve>CVE-2023-XXXXX</cve>
    </suppress>
</suppressions>
```

**Trivy:**
Create a `.trivyignore`:
```
# Not exploitable - we don't expose this endpoint
CVE-2023-XXXXX

# Will be fixed in next sprint (tracked in JIRA-1234)
CVE-2023-YYYYY
```

**npm:**
There's no built-in ignore mechanism. Options:
1. Override the vulnerable transitive dependency:
```json
{
  "overrides": {
    "lodash": "4.17.21"
  }
}
```
2. Use `npm audit fix --force` (may include breaking changes)

---

## SCA Best Practices

| Practice | Why |
|----------|-----|
| Run SCA on every PR | Catch new vulnerable deps before merge |
| Run weekly scheduled scans | Catch newly disclosed CVEs in existing deps |
| Pin dependency versions | `"express": "4.19.2"` not `"express": "^4.19.2"` for production |
| Use lock files | `package-lock.json` and `pom.xml` ensure reproducible builds |
| Update regularly | Monthly dependency updates are easier than yearly |
| Monitor for new CVEs | Dependabot/Renovate auto-create PRs for updates |
| Generate SBOM | Know exactly what's in your production software |

---

## SBOM (Software Bill of Materials)

An SBOM is a complete list of all components in your software. Think of it as an "ingredient list" for software.

**Why it matters:**
- When Log4Shell was disclosed, organizations with SBOMs knew instantly which services were affected
- Required by US Executive Order 14028 for software sold to the government
- Makes incident response faster

```bash
# Generate SBOM with Trivy
trivy fs --format spdx-json --output sbom.json .

# Generate SBOM with Syft (another tool)
syft dir:. -o spdx-json > sbom.json
```

Our pipeline generates SBOMs during the container scan stage.

---

## Summary

```
SCA answers: "Are the libraries I use safe?"

  Java:
    OWASP Dependency-Check  -->  Scans pom.xml + JARs against NVD
    Trivy filesystem scan   -->  Cross-validates, adds coverage

  Node:
    npm audit               -->  Scans package-lock.json against npm advisories
    Trivy filesystem scan   -->  Cross-validates, adds coverage

  Pipeline behavior:
    CRITICAL CVE found  -->  Pipeline FAILS  -->  Must fix before deploy
    HIGH CVE found      -->  Pipeline FAILS  -->  Must fix before deploy
    MEDIUM CVE found    -->  Warning only     -->  Fix in next sprint
```

**Next Module:** [03-SECRETS-DETECTION.md](./03-SECRETS-DETECTION.md)
