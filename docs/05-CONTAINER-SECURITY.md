# Module 6: Container Security

---

## Why Container Security Matters

When you deploy a Docker container, you ship much more than your code:

```
+-----------------------------------------------+
|  Your Docker Image                             |
|                                                |
|  +-------------------------------------------+|
|  |  Alpine Linux (OS layer)                   || <-- May have CVEs
|  |  - busybox, musl-libc, openssl, curl       ||
|  +-------------------------------------------+|
|  |  Java 17 JRE / Node.js 20 Runtime         || <-- May have CVEs
|  |  - OpenJDK, libc, libcrypt, zlib           ||
|  +-------------------------------------------+|
|  |  Application Dependencies                  || <-- SCA already checks these
|  |  - Spring Boot JARs / npm packages         ||
|  +-------------------------------------------+|
|  |  Your Application Code                     || <-- SAST already checks this
|  +-------------------------------------------+|
|                                                |
|  Dockerfile configuration                      | <-- Misconfigurations!
|  - Running as root?                            |
|  - Exposing unnecessary ports?                 |
|  - Including build tools in production?        |
+-----------------------------------------------+
```

**SCA checks your application dependencies. Container security checks the OS layer and Dockerfile configuration.**

---

## Three Pillars of Container Security

```
1. DOCKERFILE LINTING (Hadolint)
   "Is the Dockerfile written following best practices?"

2. IMAGE VULNERABILITY SCANNING (Trivy)
   "Does the built image contain OS packages with known CVEs?"

3. SBOM GENERATION (Syft)
   "What exactly is inside this image? (Bill of Materials)"
```

---

## Pillar 1: Dockerfile Best Practices

### Bad Dockerfile vs Good Dockerfile

Let's compare a vulnerable Dockerfile with our hardened version:

### BAD Dockerfile (Common Mistakes)

```dockerfile
# PROBLEM 1: Using "latest" tag - not reproducible
FROM node:latest

# PROBLEM 2: Running as root (default)
# No USER instruction = everything runs as root

# PROBLEM 3: Copying everything including .git, node_modules, .env
COPY . /app
WORKDIR /app

# PROBLEM 4: Installing dev dependencies in production
RUN npm install

# PROBLEM 5: No health check
# Container orchestrator can't detect if app is healthy

# PROBLEM 6: Using shell form (no signal handling)
CMD npm start

# PROBLEM 7: Exposing unnecessary ports not documented
```

**What can go wrong:**
- Root user means a container escape gives the attacker root on the host
- `COPY . /app` might copy `.env` files with secrets into the image
- `npm install` includes devDependencies (test tools, linters in production)
- `latest` tag means builds are not reproducible - breaks one day, works the next

### GOOD Dockerfile: order-service (Spring Boot)

From our `order-service/Dockerfile`:

```dockerfile
# ─── Build Stage ───
FROM maven:3.9-eclipse-temurin-17-alpine AS build
WORKDIR /app
COPY pom.xml .
RUN mvn dependency:go-offline -B        # Cache dependencies separately
COPY src ./src
RUN mvn clean package -DskipTests -B    # Build the JAR

# ─── Production Stage ───
FROM eclipse-temurin:17-jre-alpine      # JRE only, not full JDK

# Create non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Copy only the built JAR (not source code, not Maven)
COPY --from=build --chown=appuser:appgroup /app/target/*.jar app.jar

# Run as non-root user
USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["java", "-jar", "app.jar"]
```

**Security measures explained:**

| Line | Security Benefit |
|------|-----------------|
| `FROM ... AS build` | Multi-stage build: Maven, source code, and build tools are NOT in the final image |
| `FROM ...-jre-alpine` | JRE (not JDK): smaller attack surface. Alpine: minimal OS |
| `adduser -S appuser` | Non-root user: container escape doesn't give root access |
| `COPY --from=build` | Only the JAR file is copied - no source code, no Maven |
| `--chown=appuser` | Files owned by non-root user |
| `USER appuser` | Process runs as non-root |
| `HEALTHCHECK` | Orchestrator can detect unhealthy containers |
| `ENTRYPOINT [...]` | Exec form (not shell form) - proper signal handling |

### GOOD Dockerfile: product-service (Node.js)

From our `product-service/Dockerfile`:

```dockerfile
# ─── Build Stage ───
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --only=production            # Production deps only

# ─── Production Stage ───
FROM node:20-alpine
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup
RUN apk --no-cache add dumb-init && rm -rf /var/cache/apk/*
WORKDIR /app
COPY --from=build --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --chown=appuser:appgroup src ./src
COPY --chown=appuser:appgroup package.json ./
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
```

**Additional Node.js security measures:**

| Line | Security Benefit |
|------|-----------------|
| `npm ci --only=production` | No devDependencies in the image (jest, eslint, etc.) |
| `dumb-init` | Proper PID 1 handling - prevents zombie processes, handles signals |
| No `.env` copied | Secrets not baked into the image |

### Multi-Stage Build Visualization

```
Build Stage:                     Production Stage:
+------------------------+      +------------------------+
| maven / node           |      | JRE / node (slim)      |
| JDK                    |      |                        |
| Source code             | ---> | app.jar / src/         |
| pom.xml / package.json |  |   | node_modules/          |
| Build tools             |  |   |                        |
| Test dependencies       |  |   | Non-root user          |
| ~800MB                  |  |   | Health check           |
+------------------------+  |   | ~150MB                 |
                             |   +------------------------+
                             |
                       Only the artifact
                       is copied across
```

**Result:** Production image is ~5x smaller and has no build tools an attacker could exploit.

---

## Pillar 2: Hadolint (Dockerfile Linting)

### What is Hadolint?

Hadolint is a Dockerfile linter that checks for best practices and common mistakes.

### Running Hadolint Locally

```bash
# Install
brew install hadolint

# Lint a Dockerfile
hadolint order-service/Dockerfile
hadolint product-service/Dockerfile

# Example output for a BAD Dockerfile:
# Dockerfile:1 DL3007 warning: Using latest is prone to errors
# Dockerfile:3 DL3002 warning: Last USER should not be root
# Dockerfile:5 DL3020 error: Use COPY instead of ADD for files
# Dockerfile:7 DL3016 warning: Pin versions in pip install
# Dockerfile:9 DL3009 info: Delete apt-get lists after installing
```

### Key Hadolint Rules

| Rule | Level | What It Catches |
|------|-------|----------------|
| DL3007 | Warning | `FROM image:latest` - use specific version tags |
| DL3002 | Warning | Last USER should not be root |
| DL3020 | Error | Use `COPY` instead of `ADD` (ADD can download URLs, extract tarballs) |
| DL3003 | Warning | Use `WORKDIR` instead of `cd` |
| DL3009 | Info | Delete apt/apk cache after installing |
| DL3015 | Info | Avoid additional packages with apt-get install |
| DL4006 | Warning | Set `SHELL` option for pipes |
| SC2086 | Info | Double quote variables to prevent word splitting |

---

## Pillar 3: Trivy Image Scanning

### What Trivy Image Scan Does

Unlike the filesystem scan (SCA), the image scan checks:
- **OS packages** (alpine apk, debian apt) for CVEs
- **Language packages** (JARs, node_modules) for CVEs
- **Misconfigurations** in the image

```bash
# Build the image first
docker build -t order-service:latest order-service/

# Scan it
trivy image order-service:latest

# Only HIGH and CRITICAL
trivy image --severity HIGH,CRITICAL order-service:latest

# Fail on critical (for CI/CD)
trivy image --severity CRITICAL --exit-code 1 order-service:latest

# JSON report
trivy image --format json --output trivy-image.json order-service:latest
```

### Sample Trivy Image Scan Output

```
order-service:latest (alpine 3.19.1)
=====================================
Total: 2 (HIGH: 1, CRITICAL: 1)

+-----------+------------------+----------+-------------------+---------------+
| LIBRARY   | VULNERABILITY    | SEVERITY | INSTALLED VERSION | FIXED VERSION |
+-----------+------------------+----------+-------------------+---------------+
| libcrypto | CVE-2024-XXXXX   | CRITICAL | 3.1.4-r1          | 3.1.4-r2     |
| libssl    | CVE-2024-YYYYY   | HIGH     | 3.1.4-r1          | 3.1.4-r2     |
+-----------+------------------+----------+-------------------+---------------+

Java (jar)
==========
Total: 1 (HIGH: 1)

+-------------------+----------------+----------+-------------------+---------------+
| LIBRARY           | VULNERABILITY  | SEVERITY | INSTALLED VERSION | FIXED VERSION |
+-------------------+----------------+----------+-------------------+---------------+
| jackson-databind  | CVE-2023-ZZZZZ | HIGH    | 2.15.3            | 2.15.4        |
+-------------------+----------------+----------+-------------------+---------------+
```

**Notice two sections:**
1. **Alpine OS packages** - These are NOT in your pom.xml/package.json. They come from the base image. Only container scanning finds these.
2. **Java JARs** - These overlap with SCA, providing cross-validation.

### Fixing OS-Level CVEs

```dockerfile
# Option 1: Update base image (most common fix)
# Change:
FROM eclipse-temurin:17-jre-alpine
# To latest patched version:
FROM eclipse-temurin:17.0.11_9-jre-alpine

# Option 2: Update packages in Dockerfile
RUN apk update && apk upgrade --no-cache
```

---

## Trivy Image Scanning in Jenkins

```groovy
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
                --format json \
                --output /dev/stdout \
                ${DOCKER_REGISTRY}/order-service:${IMAGE_TAG} \
                > reports/trivy-order-image.json
        '''
    }
}
```

**Why mount Docker socket?** Trivy needs access to the Docker daemon to pull and scan the image layers.

---

## SBOM (Software Bill of Materials)

### What is an SBOM?

An SBOM is a complete inventory of everything in your container image:

```
SBOM for order-service:latest
==============================
OS: Alpine Linux 3.19.1

OS Packages:
  - busybox 1.36.1-r15
  - musl 1.2.4-r2
  - libcrypto3 3.1.4-r2
  - libssl3 3.1.4-r2
  - zlib 1.3.1-r0
  - ... (50+ more)

Java Packages:
  - spring-boot-starter-web 3.2.5
  - spring-web 6.1.6
  - jackson-databind 2.15.3
  - tomcat-embed-core 10.1.20
  - h2 2.2.224
  - ... (30+ more)
```

### Why SBOMs Matter

```
Tuesday 2pm:  New critical CVE published for "libxml2 2.9.14"
Tuesday 2pm:  Your security team asks: "Are we affected?"

WITHOUT SBOM:
  - Pull each image, scan it, wait for results
  - Check 50 microservices one by one
  - Takes hours to get an answer

WITH SBOM:
  - grep "libxml2" sbom-*.json
  - Instantly know which services are affected
  - Answer in seconds
```

### Generating SBOMs

```bash
# Using Trivy
trivy image --format spdx-json --output sbom.json order-service:latest

# Using Syft (dedicated SBOM tool)
syft order-service:latest -o spdx-json > sbom.json

# View the SBOM
cat sbom.json | jq '.packages[] | {name, versionInfo}'
```

---

## Container Security Checklist

```
Dockerfile:
  [ ] Using specific base image tag (not :latest)
  [ ] Using minimal base image (alpine, distroless, slim)
  [ ] Multi-stage build (build tools not in production image)
  [ ] Running as non-root user (USER instruction)
  [ ] COPY instead of ADD
  [ ] .dockerignore file to exclude secrets and unnecessary files
  [ ] HEALTHCHECK instruction
  [ ] Exec form for ENTRYPOINT/CMD (signal handling)
  [ ] No secrets in Dockerfile (ARG/ENV with passwords)

Image:
  [ ] No HIGH/CRITICAL OS-level CVEs
  [ ] No HIGH/CRITICAL language-level CVEs
  [ ] Image size is reasonable (not 1GB+)
  [ ] SBOM generated and stored

Runtime:
  [ ] Read-only root filesystem where possible
  [ ] No privileged mode
  [ ] Resource limits set (CPU, memory)
  [ ] Network policies restrict traffic
```

---

## .dockerignore

Both services should have a `.dockerignore` to prevent sensitive files from being copied into the image:

```
# .dockerignore
.git
.gitignore
.env
.env.*
*.md
docs/
test/
tests/
coverage/
.idea/
.vscode/
docker-compose*.yml
Jenkinsfile
*.pem
*.key
```

**Why this matters:** Even if your `COPY` command is specific, a `.dockerignore` is defense-in-depth. If someone later changes `COPY . .`, the `.env` file won't be included.

---

## Summary

```
Container Security answers: "Is the deployment package safe?"

  Hadolint:         Lints Dockerfile for best practices
  Trivy Image Scan: Scans OS packages and app dependencies in built image
  SBOM:             Generates complete inventory of image contents

  Our Dockerfiles implement:
    - Multi-stage builds (no build tools in production)
    - Non-root user (USER appuser)
    - Minimal base images (alpine)
    - Health checks
    - Proper signal handling (dumb-init / exec form)

  Pipeline:
    Stage 8 builds images and scans them with Trivy
    CRITICAL findings block the pipeline
```

**Next Module:** [06-JENKINS-PIPELINE.md](./06-JENKINS-PIPELINE.md)
