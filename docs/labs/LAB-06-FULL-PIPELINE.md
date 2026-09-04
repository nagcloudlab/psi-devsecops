# Lab 6: Full Pipeline - Run the Complete DevSecOps Pipeline

**Duration:** 30 minutes
**Tools:** Jenkins (Docker), all security tools

---

## Objective

You will:
1. Set up Jenkins locally using Docker Compose
2. Configure the pipeline job
3. Run the full pipeline and observe each security stage
4. Intentionally introduce a vulnerability and watch the pipeline block it
5. Fix the vulnerability and see the pipeline pass

---

## Part A: Start Jenkins

### Step 1: Start Jenkins with Docker Compose

```bash
cd docker
docker compose up -d jenkins
```

### Step 2: Get the Initial Admin Password

```bash
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

### Step 3: Complete Jenkins Setup

1. Open http://localhost:8081
2. Enter the admin password
3. Install suggested plugins
4. Create an admin user

### Step 4: Install Additional Plugins

Go to **Manage Jenkins > Plugins > Available Plugins** and install:
- Pipeline Utility Steps
- Docker Pipeline
- HTML Publisher
- OWASP Dependency-Check
- JaCoCo
- NodeJS

### Step 5: Configure Tools

**Manage Jenkins > Tools:**

**Maven installations:**
- Name: `Maven-3.9`
- Install automatically > Version 3.9.6

**NodeJS installations:**
- Name: `Node-20`
- Install automatically > Version 20.x

### Step 6: Set Up Docker Access

```bash
# Give Jenkins access to Docker
docker exec -u root jenkins bash -c "
    apt-get update && apt-get install -y docker.io
    chmod 666 /var/run/docker.sock
"
```

---

## Part B: Create the Pipeline Job

### Step 1: Create a New Pipeline

1. Click **New Item**
2. Name: `devsecops-pipeline`
3. Type: **Pipeline**
4. Click OK

### Step 2: Configure Pipeline

Under **Pipeline** section:
- Definition: **Pipeline script**
- Paste the contents of our `Jenkinsfile`

Or if using SCM:
- Definition: **Pipeline script from SCM**
- SCM: Git
- Repository URL: your repo URL
- Script Path: `Jenkinsfile`

### Step 3: Add Credentials

**Manage Jenkins > Credentials > System > Global:**

1. Add **Secret text**:
   - ID: `semgrep-app-token`
   - Secret: (leave empty for now, or use your Semgrep token)

2. Add **Username with password**:
   - ID: `docker-registry-creds`
   - Username: your-docker-user
   - Password: your-docker-password

---

## Part C: Run the Pipeline (Clean Code)

### Step 1: Trigger the Build

Click **Build Now** on the pipeline job.

### Step 2: Watch the Stages

Open **Stage View** to see each stage executing:

```
Checkout ✓ → Secrets ✓ → Build ✓ → Tests ✓ → SAST ✓ → SCA ✓ → Gate ✓ → ...
```

### Step 3: Review Reports

After the build completes, check:
- **Build artifacts:** Click on the build > Artifacts tab
  - `reports/gitleaks-report.json`
  - `reports/semgrep-report.json`
  - `reports/npm-audit-report.json`
- **Test Results:** Click on the build > Test Result tab
- **OWASP Dependency-Check:** If the plugin is installed, check the trend graph

---

## Part D: Break the Pipeline (Intentionally)

Now let's introduce a vulnerability and watch the pipeline catch it.

### Experiment 1: Introduce a Secret

```bash
# Add a hardcoded API key to product-service
echo 'const API_KEY = "sk_live_EXAMPLE_KEY_REPLACE_ME";' >> product-service/src/index.js
git add product-service/src/index.js
git commit -m "add config"
```

**Trigger the build.** Expected result:
- Stage 2 (Secrets Detection): Gitleaks finds the key
- Stage 7 (Quality Gate): **FAILS**
- Pipeline stops. No deployment.

### Experiment 2: Introduce a SAST Issue

```bash
# Revert the secret first
git revert HEAD --no-edit

# Add SQL injection to order-service
cat >> order-service/src/main/java/com/example/order/controller/OrderController.java << 'EOF'

    // Vulnerable search endpoint
    @GetMapping("/search")
    public String search(@RequestParam String q) {
        String query = "SELECT * FROM orders WHERE name = '" + q + "'";
        return query;
    }
EOF

git add -A && git commit -m "add search"
```

**Trigger the build.** Expected:
- Stage 5 (SAST): Semgrep flags SQL injection
- Stage 7 (Quality Gate): **FAILS**

### Experiment 3: Introduce a Vulnerable Dependency

```bash
# Revert the SAST issue
git revert HEAD --no-edit

# Add vulnerable Jackson version to pom.xml
# Edit order-service/pom.xml and add jackson-databind 2.9.8
git add -A && git commit -m "add jackson"
```

**Trigger the build.** Expected:
- Stage 6 (SCA): OWASP Dependency-Check flags critical CVEs
- Build fails on `failBuildOnCVSS=7`

---

## Part E: Fix and Pass

After each experiment, revert the change and re-run:

```bash
git revert HEAD --no-edit
# Trigger build
# Expected: All stages PASS, pipeline completes successfully
```

---

## Part F: Review the Security Dashboard

After several builds, you'll see trends:

1. **OWASP Dependency-Check trend:** Shows CVE count over time
2. **Test results trend:** Shows test pass/fail history
3. **Build history:** See which builds failed at which stage

This visibility is crucial for tracking your security posture over time.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "mvn: not found" | Configure Maven tool in Jenkins > Tools |
| "node: not found" | Configure NodeJS tool in Jenkins > Tools |
| "docker: permission denied" | Run the Docker socket chmod command (Step 6) |
| Pipeline hangs | Check timeout (30 min in our Jenkinsfile) |
| OWASP Dep-Check very slow | First run downloads NVD (~5 min). Subsequent runs use cache |
| ZAP can't reach localhost | Use `--network host` in Docker run |

---

## Key Takeaways

1. **Automated security gates work** - the pipeline blocked every vulnerability
2. **Shift left is real** - issues found in CI are cheaper to fix than in production
3. **Reports provide evidence** - archived artifacts prove security compliance
4. **Trends show progress** - track if your security posture is improving
5. **Developer experience** - fast feedback (~11 min total) doesn't slow development
