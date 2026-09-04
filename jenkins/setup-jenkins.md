# Jenkins Setup Guide for DevSecOps Pipeline

## 1. Start Jenkins

```bash
cd docker
docker compose up -d jenkins
```

Access Jenkins at: http://localhost:8081

Get initial password:
```bash
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

## 2. Install Required Plugins

Go to **Manage Jenkins > Plugins > Available** and install:

| Plugin | Purpose |
|--------|---------|
| Pipeline | Declarative pipeline support |
| Pipeline Utility Steps | `readJSON`, `fileExists` etc. |
| Maven Integration | Maven tool integration |
| NodeJS | Node.js tool integration |
| Docker Pipeline | Docker build/push in pipeline |
| OWASP Dependency-Check | SCA report visualization |
| Warnings Next Gen | SAST report aggregation |
| HTML Publisher | ZAP/coverage HTML reports |
| JaCoCo | Java code coverage |
| JUnit | Test result reporting |

Or install via CLI:
```bash
docker exec jenkins jenkins-plugin-cli --plugin-file /path/to/plugins.txt
```

## 3. Configure Tools

### Maven
**Manage Jenkins > Tools > Maven installations**
- Name: `Maven-3.9`
- Install automatically, version 3.9.x

### Node.js
**Manage Jenkins > Tools > NodeJS installations**
- Name: `Node-20`
- Install automatically, version 20.x

## 4. Add Credentials

**Manage Jenkins > Credentials > System > Global**

| ID | Type | Purpose |
|----|------|---------|
| `docker-registry-creds` | Username/Password | Docker registry login |
| `semgrep-app-token` | Secret text | Semgrep Cloud (optional) |

## 5. Create Pipeline Job

1. **New Item > Pipeline**
2. Name: `devsecops-pipeline`
3. Pipeline definition: **Pipeline script from SCM**
4. SCM: Git
5. Repository URL: your repo URL
6. Script Path: `Jenkinsfile`
7. Branch: `*/main`

## 6. Docker-in-Docker Setup

Jenkins needs Docker access for security scanners:

```bash
# Add Jenkins user to docker group
docker exec -u root jenkins groupadd docker
docker exec -u root jenkins usermod -aG docker jenkins
docker exec -u root jenkins chmod 666 /var/run/docker.sock
```

## Pipeline Flow

```
Checkout
   |
Secrets Detection (Gitleaks + TruffleHog)
   |
Build (Maven + npm - parallel)
   |
Unit Tests (JUnit + Jest - parallel)
   |
SAST (Semgrep + SpotBugs/FindSecBugs + ESLint Security - parallel)
   |
SCA (OWASP Dep-Check + npm audit + Trivy FS - parallel)
   |
Security Quality Gate (blocks pipeline on critical findings)
   |
Docker Build + Trivy Image Scan
   |
Deploy to Staging
   |
DAST (OWASP ZAP - both services)
   |
Push Images + Deploy to Production (manual approval)
```
