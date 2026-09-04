# DevSecOps Training Guide

## Complete Hands-On Training for Secure CI/CD Pipelines

**Tech Stack:** Java Spring Boot | Node.js Express | Jenkins | Docker
**Duration:** Full-day workshop (6-8 hours)
**Prerequisite:** Familiarity with Java/Spring Boot, Node/Express, basic Docker and Git

---

## Table of Contents

| # | Module | Document | Duration |
|---|--------|----------|----------|
| 1 | What is DevSecOps & Why it Matters | This file | 45 min |
| 2 | SAST - Static Application Security Testing | [01-SAST.md](./01-SAST.md) | 60 min |
| 3 | SCA - Software Composition Analysis | [02-SCA.md](./02-SCA.md) | 45 min |
| 4 | Secrets Detection | [03-SECRETS-DETECTION.md](./03-SECRETS-DETECTION.md) | 30 min |
| 5 | DAST - Dynamic Application Security Testing | [04-DAST.md](./04-DAST.md) | 45 min |
| 6 | Container Security | [05-CONTAINER-SECURITY.md](./05-CONTAINER-SECURITY.md) | 45 min |
| 7 | Jenkins Pipeline Walkthrough | [06-JENKINS-PIPELINE.md](./06-JENKINS-PIPELINE.md) | 60 min |
| 8 | Hands-On Labs | [labs/](./labs/) | 90 min |

---

# Module 1: What is DevSecOps & Why it Matters

---

## 1.1 The Problem: Traditional Security is Too Late

In traditional software development, security testing happens at the end:

```
Plan --> Code --> Build --> Test --> (SECURITY REVIEW) --> Deploy
                                         ^
                                         |
                                   Found 47 vulnerabilities!
                                   "Go back and fix everything."
                                   Cost: $$$$$ | Delay: 3 weeks
```

**What goes wrong:**

| Problem | Impact |
|---------|--------|
| Security review happens after development is "done" | Developers have moved on to other features |
| Vulnerabilities found late are expensive to fix | 6x-30x more costly than finding them during coding |
| Security team becomes a bottleneck | Entire release blocked waiting for review |
| Developers vs Security team conflict | "You broke our timeline" vs "You wrote insecure code" |
| Manual reviews don't scale | 100s of PRs per week, 2 security engineers |

**Real-world examples of what happens without DevSecOps:**

- **Equifax (2017):** Unpatched Apache Struts dependency (SCA would have caught this). 147 million records exposed. Cost: $1.4 billion.
- **SolarWinds (2020):** Compromised build pipeline. 18,000 organizations affected. Attackers injected malicious code during CI/CD.
- **Log4Shell (2021):** Critical vulnerability in log4j library. Every Java application using it was vulnerable. Organizations without SCA took weeks to even identify affected services.
- **Uber (2022):** Hardcoded credentials in source code (secrets detection would have caught this). Complete internal system compromise.

---

## 1.2 The Solution: Shift Left - DevSecOps

DevSecOps means: **embed security into every stage of the development lifecycle, automatically.**

```
Plan -----> Code ---------> Build ---------> Test ---------> Deploy -------> Monitor
  |           |                |                |                |              |
  |     [Pre-commit]    [SAST + SCA]      [DAST]          [Image Scan]   [Runtime]
  |     - Gitleaks       - Semgrep        - OWASP ZAP     - Trivy        - WAF
  |     - Lint           - SpotBugs       - API Scan      - Signing      - SIEM
  |                      - npm audit                                     - Alerts
  |                      - Dep-Check
  |                      - Trivy
  |
  [Threat Modeling]
```

**"Shift Left" means:** Find problems as early as possible, when they are cheapest to fix.

```
Cost to fix a vulnerability:

  Design Phase:     $                (change a design document)
  Coding Phase:     $$               (developer fixes before commit)
  Build/CI Phase:   $$$              (pipeline catches it, PR rejected)
  Testing Phase:    $$$$             (QA finds it, sent back to dev)
  Production:       $$$$$$$$$$$$     (incident response, breach, legal)
```

---

## 1.3 DevSecOps Building Blocks

There are 5 core security scanning categories. Each catches a different class of vulnerability:

### Overview Table

| Category | What It Scans | When It Runs | What It Catches | Tools (Our Pipeline) |
|----------|--------------|--------------|-----------------|---------------------|
| **SAST** | Your source code | Every commit/PR | SQL injection, XSS, hardcoded secrets in code, insecure patterns | Semgrep, SpotBugs+FindSecBugs, ESLint Security |
| **SCA** | Your dependencies | Every build | Known CVEs in libraries you use (like log4j) | OWASP Dependency-Check, npm audit, Trivy |
| **Secrets** | Git history + files | Every commit | API keys, passwords, tokens, certificates committed to repo | Gitleaks, TruffleHog |
| **DAST** | Running application | After deployment to staging | XSS, SQL injection, misconfigurations visible at runtime | OWASP ZAP |
| **Container** | Docker images | After image build | OS-level CVEs, misconfigurations, bloated images | Trivy, Hadolint |

### How They Work Together

Think of it as layers of defense. No single tool catches everything:

```
                    Your Application
                    ================

Layer 1: SECRETS    "Did anyone commit a password?"
                    Catches: API keys, tokens, credentials in code/config
                    Missed by: SAST (focuses on logic, not secret patterns)

Layer 2: SAST       "Is the code itself written securely?"
                    Catches: SQL injection, XSS, insecure crypto, bad patterns
                    Missed by: SCA (only looks at dependencies, not your code)

Layer 3: SCA        "Are the libraries we use safe?"
                    Catches: Known CVEs in Spring Boot, Express, lodash, etc.
                    Missed by: SAST (doesn't analyze library internals)

Layer 4: CONTAINER  "Is the deployment package safe?"
                    Catches: Vulnerable OS packages, root user, exposed ports
                    Missed by: SAST/SCA (don't look at OS-level packages)

Layer 5: DAST       "Can an attacker actually exploit something?"
                    Catches: Runtime misconfigs, headers, real XSS/SQLi
                    Missed by: Everything above (they don't test running app)
```

---

## 1.4 Our Pipeline Architecture

We have 2 microservices and a Jenkins pipeline with 11 stages:

### The Two Services

```
+---------------------+         +---------------------+
|   order-service      |  HTTP   |   product-service    |
|   (Spring Boot)      |-------->|   (Node Express)     |
|                      |         |                      |
|   POST /api/orders   |         |   GET /api/products  |
|   GET  /api/orders   |         |   POST /api/products |
|   GET  /api/orders/1 |         |   DELETE /api/products/1 |
|   DELETE /api/orders/1|        |                      |
|                      |         |   Port: 3000         |
|   Port: 8080         |         +---------------------+
+---------------------+
```

**Why two different tech stacks?**
- Real-world microservices often use different languages
- Shows how DevSecOps tools apply to both Java and Node.js ecosystems
- Different tools are better suited for different stacks (SpotBugs for Java, ESLint Security for Node)

### The 11-Stage Jenkins Pipeline

```
 STAGE 1   Checkout
              |
 STAGE 2   Secrets Detection ----+---- Gitleaks
              |                   +---- TruffleHog
              |
 STAGE 3   Build -----------------+---- mvn compile (Java)
              |                   +---- npm ci + lint (Node)
              |
 STAGE 4   Unit Tests ------------+---- JUnit + JaCoCo (Java)
              |                   +---- Jest + Coverage (Node)
              |
 STAGE 5   SAST ------------------+---- Semgrep (both)
              |                   +---- SpotBugs + FindSecBugs (Java)
              |                   +---- ESLint Security (Node)
              |
 STAGE 6   SCA -------------------+---- OWASP Dependency-Check (Java)
              |                   +---- npm audit (Node)
              |                   +---- Trivy filesystem scan (both)
              |
 STAGE 7   Security Quality Gate
              |           |
              |     FAIL = Pipeline stops here.
              |     No vulnerable code reaches production.
              |
 STAGE 8   Docker Build + Image Scan (Trivy)
              |
 STAGE 9   Deploy to Staging
              |
 STAGE 10  DAST (OWASP ZAP) -----+---- ZAP on order-service
              |                   +---- ZAP on product-service
              |
 STAGE 11  Push Images + Deploy to Production (manual approval)
```

**Key design decisions:**
1. **Secrets detection runs FIRST** - If credentials are leaked, nothing else matters
2. **SAST + SCA run in PARALLEL** - Saves time; they are independent checks
3. **Security Quality Gate BLOCKS the pipeline** - Critical findings = no deployment
4. **DAST runs AFTER staging deploy** - Needs a running application to test
5. **Production deploy needs MANUAL APPROVAL** - Human in the loop for final check

---

## 1.5 Understanding OWASP Top 10

The OWASP Top 10 is the industry standard list of most critical web application security risks. Our pipeline tools map directly to these:

| # | OWASP Risk | Example | Which Tool Catches It |
|---|-----------|---------|----------------------|
| A01 | Broken Access Control | User can access another user's orders | DAST (ZAP) |
| A02 | Cryptographic Failures | Using MD5 for password hashing | SAST (Semgrep, SpotBugs) |
| A03 | Injection | SQL injection in order query | SAST + DAST |
| A04 | Insecure Design | No rate limiting on login | SAST (pattern), DAST |
| A05 | Security Misconfiguration | Debug mode enabled in production | DAST, Container scan |
| A06 | Vulnerable Components | Using log4j 2.14.1 | SCA (Dep-Check, npm audit) |
| A07 | Auth Failures | Hardcoded API keys | Secrets Detection |
| A08 | Software Integrity Failures | Compromised dependency | SCA + SBOM |
| A09 | Logging Failures | Not logging auth failures | SAST (Semgrep rules) |
| A10 | SSRF | order-service fetches arbitrary URLs | SAST + DAST |

---

## 1.6 Key Terminology

| Term | Meaning | Example |
|------|---------|---------|
| **CVE** | Common Vulnerabilities and Exposures - unique ID for a known vulnerability | CVE-2021-44228 (Log4Shell) |
| **CVSS** | Common Vulnerability Scoring System - severity score 0-10 | 9.8 = Critical, 7.5 = High |
| **SARIF** | Static Analysis Results Interchange Format - standard report format | All SAST tools can output SARIF |
| **SBOM** | Software Bill of Materials - list of all components in your software | Like an ingredient list for software |
| **CWE** | Common Weakness Enumeration - categorizes types of weaknesses | CWE-89 = SQL Injection |
| **False Positive** | Tool reports a vulnerability that isn't actually exploitable | Semgrep flags a test file as "hardcoded password" |
| **True Positive** | Tool correctly identifies a real vulnerability | Gitleaks finds an actual AWS key |
| **Quality Gate** | A checkpoint that blocks pipeline progression if criteria aren't met | "No CRITICAL CVEs allowed" |
| **Shift Left** | Moving security earlier in the development lifecycle | Pre-commit hooks instead of post-deploy audits |

---

## 1.7 Project Structure

```
devsecops/
|
+-- order-service/                  <-- Java Spring Boot microservice
|   +-- pom.xml                     <-- Maven config with security plugins
|   +-- Dockerfile                  <-- Multi-stage, hardened container
|   +-- src/main/java/...           <-- Application source code
|   +-- src/test/java/...           <-- Unit tests
|
+-- product-service/                <-- Node.js Express microservice
|   +-- package.json                <-- npm config with security deps
|   +-- Dockerfile                  <-- Multi-stage, hardened container
|   +-- src/                        <-- Application source code
|   +-- test/                       <-- Jest tests
|   +-- .eslintrc.json              <-- ESLint + security plugin config
|
+-- Jenkinsfile                     <-- The DevSecOps pipeline (heart of this project)
|
+-- docker/
|   +-- docker-compose.yml          <-- Run Jenkins + services locally
|   +-- docker-compose.staging.yml  <-- Staging deployment config
|
+-- security-config/
|   +-- gitleaks.toml               <-- Secrets detection rules
|   +-- zap-rules.tsv               <-- OWASP ZAP scan rules
|
+-- jenkins/
|   +-- plugins.txt                 <-- Required Jenkins plugins
|   +-- setup-jenkins.md            <-- Jenkins setup instructions
|
+-- docs/                           <-- You are here!
    +-- 00-DEVSECOPS-TRAINING-GUIDE.md
    +-- 01-SAST.md
    +-- 02-SCA.md
    +-- 03-SECRETS-DETECTION.md
    +-- 04-DAST.md
    +-- 05-CONTAINER-SECURITY.md
    +-- 06-JENKINS-PIPELINE.md
    +-- labs/
        +-- LAB-01-SAST.md
        +-- LAB-02-SCA.md
        +-- LAB-03-SECRETS.md
        +-- LAB-04-DAST.md
        +-- LAB-05-CONTAINER.md
        +-- LAB-06-FULL-PIPELINE.md
        +-- vulnerable-samples/     <-- Intentionally vulnerable code for labs
```

---

## 1.8 What You Will Learn

By the end of this training, you will be able to:

- [ ] Explain why DevSecOps matters and what "shift left" means
- [ ] Set up and run SAST scans using Semgrep (both Java and Node)
- [ ] Set up and run SAST scans using SpotBugs + FindSecBugs (Java)
- [ ] Run SCA scans using OWASP Dependency-Check and npm audit
- [ ] Detect secrets in code using Gitleaks and TruffleHog
- [ ] Run DAST scans using OWASP ZAP against a live application
- [ ] Scan Docker images for vulnerabilities using Trivy
- [ ] Write hardened Dockerfiles (non-root, multi-stage, health checks)
- [ ] Build a complete Jenkins pipeline with all security stages
- [ ] Implement a security quality gate that blocks vulnerable deployments
- [ ] Interpret scan reports and triage findings (true positive vs false positive)
- [ ] Fix common vulnerabilities in both Java and Node.js code

---

**Next Module:** [01-SAST.md - Static Application Security Testing](./01-SAST.md)
