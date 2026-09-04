# Module 7: Jenkins Pipeline Walkthrough

---

## Pipeline Overview

Our `Jenkinsfile` is a **Declarative Pipeline** with 11 stages. This document walks through every stage, explaining what it does and why.

```
 Stage  1: Checkout ..................... Get the code
 Stage  2: Secrets Detection ........... Gitleaks + TruffleHog
 Stage  3: Build ....................... Compile Java + Install Node deps
 Stage  4: Unit Tests .................. JUnit + Jest with coverage
 Stage  5: SAST ........................ Semgrep + SpotBugs + ESLint Security
 Stage  6: SCA ......................... OWASP Dep-Check + npm audit + Trivy
 Stage  7: Security Quality Gate ....... PASS/FAIL decision
 Stage  8: Docker Build & Scan ......... Build images + Trivy image scan
 Stage  9: Deploy to Staging ........... docker compose up
 Stage 10: DAST ........................ OWASP ZAP scan both services
 Stage 11: Push & Deploy Production .... Manual approval + deploy
```

---

## Pipeline Structure Explained

### Header Section

```groovy
pipeline {
    agent any                      // Run on any available Jenkins agent

    tools {
        maven 'Maven-3.9'         // Auto-install Maven 3.9 (configured in Jenkins)
        nodejs 'Node-20'          // Auto-install Node.js 20 (configured in Jenkins)
    }

    environment {
        DOCKER_REGISTRY = 'your-registry.example.com'
        IMAGE_TAG       = "${env.BUILD_NUMBER}-${env.GIT_COMMIT?.take(7) ?: 'latest'}"
        SEMGREP_APP_TOKEN = credentials('semgrep-app-token')
    }

    options {
        timeout(time: 30, unit: 'MINUTES')     // Kill build if stuck
        disableConcurrentBuilds()               // One build at a time
        buildDiscarder(logRotator(numToKeepStr: '20'))  // Keep last 20 builds
    }
```

**Key points:**
- `tools`: Jenkins auto-installs Maven and Node (configured in Manage Jenkins > Tools)
- `IMAGE_TAG`: Combines build number + git commit hash for unique, traceable tags. Example: `42-a1b2c3d`
- `credentials('semgrep-app-token')`: Securely injects the Semgrep token from Jenkins credentials store (never hardcoded)
- `timeout`: Prevents builds from running forever if a scan hangs
- `disableConcurrentBuilds`: Prevents race conditions with Docker images

---

## Stage 1: Checkout

```groovy
stage('Checkout') {
    steps {
        checkout scm
        sh 'echo "Branch: ${GIT_BRANCH} | Commit: ${GIT_COMMIT}"'
    }
}
```

**What it does:** Pulls the source code from the configured SCM (Git).
**Why:** Everything else needs the code.

---

## Stage 2: Secrets Detection

```groovy
stage('Secrets Detection') {
    parallel {
        stage('Gitleaks') {
            steps {
                sh '''
                    docker run --rm -v $(pwd):/repo \
                        zricethezav/gitleaks:latest \
                        detect --source /repo \
                        --config /repo/security-config/gitleaks.toml \
                        --report-path /repo/reports/gitleaks-report.json \
                        --report-format json \
                        --verbose
                '''
            }
        }
        stage('TruffleHog') {
            steps {
                sh '''
                    docker run --rm -v $(pwd):/repo \
                        trufflesecurity/trufflehog:latest \
                        filesystem /repo \
                        --only-verified \
                        --json > reports/trufflehog-report.json || true
                '''
            }
        }
    }
}
```

**What it does:** Runs Gitleaks and TruffleHog in PARALLEL.
**Why it runs FIRST:** If credentials are leaked, nothing else matters. A leaked AWS key can cause more damage in 5 minutes than any SQL injection.

**Pattern: `parallel {}`**
```
Without parallel:  Gitleaks (30s) --> TruffleHog (45s) = 75s total
With parallel:     Gitleaks (30s) --|
                   TruffleHog (45s)-|-- = 45s total (whichever is slower)
```

**Docker pattern:** `docker run --rm -v $(pwd):/repo <tool>`
- We run security tools in Docker containers instead of installing them on Jenkins
- `--rm`: Delete the container after it finishes
- `-v $(pwd):/repo`: Mount the project code into the container
- No tool installation or version management on Jenkins itself

---

## Stage 3: Build

```groovy
stage('Build') {
    parallel {
        stage('Build order-service') {
            steps {
                dir('order-service') {
                    sh 'mvn clean compile -B'
                }
            }
        }
        stage('Build product-service') {
            steps {
                dir('product-service') {
                    sh 'npm ci'
                    sh 'npm run lint'
                }
            }
        }
    }
}
```

**What it does:**
- Java: `mvn clean compile` - Compiles the Spring Boot application
- Node: `npm ci` - Installs exact versions from lock file, then `npm run lint` checks code quality

**Why `npm ci` instead of `npm install`?**
```
npm install:                    npm ci:
- May update lock file          - Never modifies lock file
- Resolves version ranges       - Uses exact versions from lock file
- Faster for development        - Reproducible CI builds
- Can introduce different        - Same deps every time
  versions between builds
```

**`-B` flag (Maven):** Batch mode - no interactive prompts, cleaner CI output.

---

## Stage 4: Unit Tests

```groovy
stage('Unit Tests') {
    parallel {
        stage('Test order-service') {
            steps {
                dir('order-service') { sh 'mvn test -B' }
            }
            post {
                always {
                    junit 'order-service/target/surefire-reports/*.xml'
                    jacoco(execPattern: 'order-service/target/jacoco.exec')
                }
            }
        }
        stage('Test product-service') {
            steps {
                dir('product-service') { sh 'npm run test:ci' }
            }
            post {
                always {
                    junit 'product-service/coverage/junit.xml'
                    publishHTML(target: [
                        reportDir: 'product-service/coverage/lcov-report',
                        reportFiles: 'index.html',
                        reportName: 'Node Coverage Report'
                    ])
                }
            }
        }
    }
}
```

**What it does:** Runs tests for both services in parallel, publishes results to Jenkins.

**`post { always { } }`** - Runs even if the stage fails. This ensures test reports are always published to Jenkins, so you can see WHICH tests failed.

**Jenkins integrations:**
- `junit`: Parses JUnit XML reports, shows test results in Jenkins UI
- `jacoco`: Java code coverage reports with trend graphs
- `publishHTML`: Publishes the Istanbul/lcov HTML coverage report for Node

---

## Stage 5: SAST

```groovy
stage('SAST') {
    parallel {
        stage('Semgrep') { ... }                    // Both Java + Node
        stage('SpotBugs + FindSecBugs (Java)') { ... }  // Java only
        stage('ESLint Security (Node)') { ... }     // Node only
    }
}
```

**Three tools run in parallel:**
1. **Semgrep** scans both services (multi-language)
2. **SpotBugs** does deep bytecode analysis (Java only, needs compiled code from Stage 3)
3. **ESLint Security** catches Node-specific patterns

**Why not just use Semgrep for everything?**
- SpotBugs does data-flow analysis that Semgrep can't do for Java
- ESLint is already integrated into the Node dev workflow
- Defense in depth: multiple tools catch more issues

---

## Stage 6: SCA

```groovy
stage('SCA') {
    parallel {
        stage('OWASP Dependency-Check (Java)') {
            steps {
                dir('order-service') {
                    sh 'mvn org.owasp:dependency-check-maven:check -B'
                }
            }
            post {
                always {
                    dependencyCheckPublisher pattern:
                        'order-service/target/dependency-check-report.json'
                }
            }
        }
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
    }
}
```

**Three SCA tools in parallel:**
1. **OWASP Dep-Check** for Java (deep NVD analysis, creates Jenkins dashboard)
2. **npm audit** for Node (fast, uses npm advisory DB)
3. **Trivy** for both (cross-validates and catches what others miss)

**Pattern: `|| true` then strict check**
```bash
npm audit --json > report.json || true    # Generate report even if vulns found
npm audit --audit-level=critical           # Fail only on CRITICAL
```
First line always succeeds (report is generated). Second line fails the stage only if CRITICAL vulnerabilities exist.

---

## Stage 7: Security Quality Gate

This is the most important stage - it decides whether the code is safe to deploy.

```groovy
stage('Security Quality Gate') {
    steps {
        script {
            def gatePass = true
            def issues = []

            // Check Gitleaks results
            if (fileExists('reports/gitleaks-report.json')) {
                def gitleaksReport = readJSON file: 'reports/gitleaks-report.json'
                if (gitleaksReport instanceof List && gitleaksReport.size() > 0) {
                    issues.add("Gitleaks: ${gitleaksReport.size()} secret(s) detected")
                    gatePass = false
                }
            }

            // Check Semgrep results
            if (fileExists('reports/semgrep-report.json')) {
                def semgrepReport = readJSON file: 'reports/semgrep-report.json'
                def errors = semgrepReport.results?.findAll {
                    it.extra?.severity == 'ERROR'
                } ?: []
                if (errors.size() > 0) {
                    issues.add("Semgrep: ${errors.size()} ERROR-level finding(s)")
                    gatePass = false
                }
            }

            if (!gatePass) {
                error("Security Quality Gate FAILED: ${issues.join(', ')}")
            }
        }
    }
}
```

**What it does:**
1. Reads the JSON reports from previous security scans
2. Checks for blocking findings:
   - ANY leaked secrets = FAIL
   - ANY ERROR-level SAST findings = FAIL
3. Prints a summary table
4. Calls `error()` to STOP the pipeline if the gate fails

**Why a dedicated gate stage?**
- Individual scan stages might use `|| true` to ensure reports are generated
- The quality gate is the single point where we enforce "go / no-go"
- It provides a clear summary of all security findings in one place
- Easy to adjust thresholds without modifying individual scan stages

**Customizing the gate:**
```groovy
// Stricter gate (also check Trivy)
if (fileExists('reports/trivy-fs-report.json')) {
    def trivyReport = readJSON file: 'reports/trivy-fs-report.json'
    def criticals = trivyReport.Results?.collect { it.Vulnerabilities?.findAll {
        v -> v.Severity == 'CRITICAL'
    } }?.flatten()?.size() ?: 0
    if (criticals > 0) {
        issues.add("Trivy: ${criticals} CRITICAL vulnerability(ies)")
        gatePass = false
    }
}
```

---

## Stage 8: Docker Build & Image Scan

```groovy
stage('Docker Build & Scan') {
    parallel {
        stage('order-service Image') {
            steps {
                dir('order-service') {
                    sh "mvn package -DskipTests -B"
                    sh "docker build -t ${DOCKER_REGISTRY}/order-service:${IMAGE_TAG} ."
                }
                sh '''
                    docker run --rm \
                        -v /var/run/docker.sock:/var/run/docker.sock \
                        aquasec/trivy:latest image \
                        --severity HIGH,CRITICAL \
                        ${DOCKER_REGISTRY}/order-service:${IMAGE_TAG} \
                        > reports/trivy-order-image.json
                '''
            }
        }
        stage('product-service Image') { ... } // Same pattern
    }
}
```

**What it does:**
1. Packages the application (creates JAR for Java)
2. Builds the Docker image
3. Scans the built image with Trivy

**Why `-DskipTests`?** Tests already passed in Stage 4. No need to run them again.

**`-v /var/run/docker.sock`:** Gives the Trivy container access to the Docker daemon on the Jenkins agent, so it can pull and scan the image we just built.

---

## Stage 9: Deploy to Staging

```groovy
stage('Deploy to Staging') {
    when {
        anyOf {
            branch 'main'
            branch 'develop'
        }
    }
    steps {
        sh '''
            docker compose -f docker/docker-compose.staging.yml up -d
            sleep 15
            curl -sf http://localhost:8080/actuator/health || echo "order-service not ready"
            curl -sf http://localhost:3000/health || echo "product-service not ready"
        '''
    }
}
```

**`when { branch 'main' }`** - Only deploys on main/develop branches, NOT on feature branches or PRs.

**What it does:**
1. Starts both services using Docker Compose
2. Waits for them to be ready
3. Health checks to verify deployment succeeded

---

## Stage 10: DAST

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
            post {
                always {
                    publishHTML(target: [
                        reportDir: 'reports',
                        reportFiles: 'zap-order-report.html',
                        reportName: 'ZAP Report - order-service'
                    ])
                }
            }
        }
        // Same for product-service
    }
}
```

**Why `--network host`?** ZAP needs to reach the services running on the Jenkins agent's localhost.
**Why `|| true`?** We don't want ZAP scan failures to immediately stop the pipeline - we want the report to be generated and published first.

---

## Stage 11: Push & Deploy Production

```groovy
stage('Push Images') {
    when { branch 'main' }
    steps {
        withCredentials([usernamePassword(
            credentialsId: 'docker-registry-creds',
            usernameVariable: 'DOCKER_USER',
            passwordVariable: 'DOCKER_PASS'
        )]) {
            sh '''
                echo "$DOCKER_PASS" | docker login ${DOCKER_REGISTRY} \
                    -u "$DOCKER_USER" --password-stdin
                docker push ${DOCKER_REGISTRY}/order-service:${IMAGE_TAG}
                docker push ${DOCKER_REGISTRY}/product-service:${IMAGE_TAG}
            '''
        }
    }
}

stage('Deploy to Production') {
    when { branch 'main' }
    input {
        message 'Deploy to production?'
        ok 'Yes, deploy!'
        submitter 'admin,deployer'
    }
    steps {
        sh 'echo "Deploying to production..."'
    }
}
```

**`withCredentials`:** Securely injects Docker registry username/password. They are NEVER printed in logs.

**`input { submitter 'admin,deployer' }`:**
- Pipeline PAUSES here and waits for human approval
- Only users with 'admin' or 'deployer' role can approve
- This is the manual gate before production deployment

```
Pipeline execution:
  Stage 1-10: Automated ------> Stage 11: [PAUSE]
                                           |
                                    "Deploy to production?"
                                    [Yes, deploy!] [Abort]
                                           |
                                    Only admin/deployer
                                    can click "Yes"
```

---

## Post Section (Cleanup)

```groovy
post {
    always {
        archiveArtifacts artifacts: 'reports/**/*', allowEmptyArchive: true
    }
    success {
        echo 'Pipeline completed successfully with all security gates passed.'
    }
    failure {
        echo 'Pipeline FAILED.'
        // mail to: 'team@example.com', subject: "FAILED: ${env.JOB_NAME}"
    }
    cleanup {
        sh 'docker compose -f docker/docker-compose.staging.yml down || true'
        cleanWs()
    }
}
```

**`post` blocks run after the pipeline finishes:**
- `always`: Archive all reports (available in Jenkins even if build fails)
- `success`: Notification on success
- `failure`: Alert on failure (uncomment mail for email notifications)
- `cleanup`: Tear down staging environment, clean workspace

---

## Pipeline Duration Estimate

```
Stage 1  Checkout:              ~10s
Stage 2  Secrets Detection:     ~30s   (parallel)
Stage 3  Build:                 ~60s   (parallel)
Stage 4  Unit Tests:            ~30s   (parallel)
Stage 5  SAST:                  ~90s   (parallel)
Stage 6  SCA:                   ~120s  (parallel, OWASP Dep-Check is slow first run)
Stage 7  Security Quality Gate: ~5s
Stage 8  Docker Build & Scan:   ~120s  (parallel)
Stage 9  Deploy to Staging:     ~20s
Stage 10 DAST:                  ~180s  (parallel)
Stage 11 Push & Production:     ~30s   (+ manual approval wait time)
                                ─────
                          Total: ~11 minutes
```

Using `parallel {}` blocks saves roughly 40% pipeline time compared to sequential execution.

---

## Required Jenkins Configuration

### Plugins Needed

| Plugin | Used By |
|--------|---------|
| Pipeline | Declarative pipeline syntax |
| Pipeline Utility Steps | `readJSON`, `fileExists` in quality gate |
| Maven Integration | `mvn` tool auto-install |
| NodeJS | `node/npm` tool auto-install |
| Docker Pipeline | Docker commands in pipeline |
| OWASP Dependency-Check | `dependencyCheckPublisher` |
| HTML Publisher | ZAP and coverage reports |
| JaCoCo | Java code coverage |
| JUnit | Test result publishing |
| Credentials Binding | `withCredentials`, `credentials()` |

### Credentials Needed

| ID | Type | Purpose |
|----|------|---------|
| `docker-registry-creds` | Username/Password | Docker registry login |
| `semgrep-app-token` | Secret text | Semgrep Cloud (optional) |

---

## Summary

```
The Jenkinsfile implements:
  - 11 stages covering the full DevSecOps lifecycle
  - Parallel execution where possible (~40% time savings)
  - Docker-based security tools (no installation on Jenkins)
  - Security quality gate that blocks vulnerable code
  - Manual approval for production deployment
  - Report archiving for every build
  - Cleanup of staging environment after DAST
```

**Next:** [Hands-On Labs](./labs/) - Practice everything you've learned!
