# Module 4: Secrets Detection

---

## What is Secrets Detection?

Secrets detection scans your **code, config files, and git history** for accidentally committed credentials: API keys, passwords, tokens, certificates, connection strings.

**Analogy:** Imagine you accidentally left your house key taped to the front door with a label "HOUSE KEY". Secrets detection is the neighbor who notices and alerts you before a burglar does.

```
Secrets scanners look for patterns like:

  AWS:      AKIA[0-9A-Z]{16}
  GitHub:   ghp_[a-zA-Z0-9]{36}
  Slack:    xoxb-[0-9]{11}-[0-9]{11}-[a-zA-Z0-9]{24}
  Generic:  password = "actual_password_here"
  JDBC:     jdbc:mysql://user:password@host:3306/db
  PEM:      -----BEGIN RSA PRIVATE KEY-----
```

---

## Why This is Critical

**Once a secret is committed to Git, it's in the history FOREVER** (until you rewrite history, which is painful):

```
Day 1:  Developer commits application.yml with DB password
Day 2:  Developer realizes mistake, deletes the password, commits again
Day 3:  Password is GONE from the current file...

BUT:    git log -p application.yml   <-- STILL SHOWS THE PASSWORD
        git show abc1234:application.yml  <-- STILL THERE

Even if you delete the file entirely, git history preserves it.
Attackers know this. They scan public repos for leaked secrets.
```

**Real stats:**
- GitHub scans 100M+ commits/day and finds 1000s of leaked secrets
- Average time for a leaked AWS key to be exploited: **< 1 minute** (automated bots)
- GitGuardian reports 10M+ secrets exposed in public repos in 2023

### What happens when secrets leak:

```
Leaked AWS key
    |
    v (within seconds)
Bot finds it on GitHub
    |
    v (within minutes)
Bot spins up crypto mining instances on your AWS account
    |
    v (within hours)
You get a $50,000 AWS bill
```

---

## Secrets Detection Tools

| Tool | How It Works | Strengths |
|------|-------------|-----------|
| **Gitleaks** | Regex patterns + entropy analysis on git history | Fast, configurable, scans full git history |
| **TruffleHog** | Regex + entropy + **verifies** secrets are real | Fewer false positives (actually tests if key works) |

### Why Both?

```
Gitleaks:     Fast, broad detection, catches patterns
              "This looks like an API key" (may be false positive)

TruffleHog:   Slower, but verifies findings
              "This IS an API key, and I confirmed it's still active"
```

Using both gives you speed (Gitleaks as first pass) and accuracy (TruffleHog confirms).

---

## Tool 1: Gitleaks

### How Gitleaks Works

1. Clones or reads the repository
2. Scans every commit in git history (not just current files)
3. Matches content against 150+ regex patterns for known secret formats
4. Also uses entropy analysis (high-entropy strings are likely secrets)

### Running Gitleaks Locally

```bash
# Install
brew install gitleaks

# Scan current directory (all files)
gitleaks detect --source .

# Scan with verbose output
gitleaks detect --source . --verbose

# Scan git history (catches secrets in old commits)
gitleaks detect --source . --log-opts="--all"

# Generate JSON report
gitleaks detect --source . --report-path gitleaks-report.json --report-format json

# Use our custom config
gitleaks detect --source . --config security-config/gitleaks.toml

# Scan only staged changes (pre-commit hook)
gitleaks protect --staged
```

### Gitleaks Configuration

From our `security-config/gitleaks.toml`:

```toml
[extend]
useDefault = true            # Use all 150+ built-in rules

[allowlist]
paths = [
    '''node_modules''',      # Skip dependencies
    '''package-lock\.json''', # Skip lock files
    '''target/''',           # Skip build output
]

# Custom rule: catch JDBC passwords in Spring config
[[rules]]
id = "custom-jdbc-password"
description = "Detected JDBC password in config"
regex = '''(?i)(jdbc|datasource).*password\s*[:=]\s*['"]?(.{8,})['"]?'''
keywords = ["jdbc", "datasource", "password"]
```

### What Gitleaks Catches

**1. AWS Access Keys**
```yaml
# CAUGHT by Gitleaks
aws:
  access-key-id: AKIAIOSFODNN7EXAMPLE
  secret-access-key: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

**2. Database passwords in Spring config**
```yaml
# CAUGHT by Gitleaks
spring:
  datasource:
    url: jdbc:mysql://prod-db:3306/orders
    username: admin
    password: Pr0d_P@ssw0rd!     # <-- FLAGGED
```

**3. API tokens in Node config**
```javascript
// CAUGHT by Gitleaks
const config = {
    stripeKey: 'sk_live_EXAMPLE_KEY_REPLACE_ME',
    sendgridKey: 'SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
};
```

**4. Private keys**
```
# CAUGHT by Gitleaks
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWoF5...
-----END RSA PRIVATE KEY-----
```

### Gitleaks Output Example

```json
[
    {
        "Description": "AWS Access Key",
        "StartLine": 15,
        "EndLine": 15,
        "File": "order-service/src/main/resources/application.yml",
        "Commit": "a1b2c3d4e5f6",
        "Author": "developer@example.com",
        "Date": "2024-03-15",
        "Rule": "aws-access-key-id",
        "Match": "AKIAIOSFODNN7EXAMPLE"
    }
]
```

**Notice:** It tells you the **commit** and **author** - so you know who committed it and when.

---

## Tool 2: TruffleHog

### How TruffleHog Works

```
                Your Repository
                      |
                      v
              +-----------------+
              |   TruffleHog    |
              |                 |
              | 1. Scan files   |
              | 2. Find matches |
              | 3. VERIFY them  |  <-- This is the key difference
              +-----------------+
                      |
                      v
        "Found AWS key AKIA... - VERIFIED ACTIVE"
                                  ^
                                  |
                    TruffleHog actually calls AWS API
                    to check if the key is still valid!
```

**Why verification matters:**
- Gitleaks might find 20 "secrets" - some are old, rotated, or test values
- TruffleHog finds 5 and confirms: "These 3 are still active and working"
- You focus on the 3 that actually matter

### Running TruffleHog Locally

```bash
# Install
brew install trufflehog

# Scan filesystem
trufflehog filesystem .

# Scan only for verified (active) secrets
trufflehog filesystem . --only-verified

# Scan git history
trufflehog git file://. --only-verified

# JSON output
trufflehog filesystem . --json > trufflehog-report.json
```

### TruffleHog in Jenkins

```groovy
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
```

`--only-verified` means: only report secrets that TruffleHog confirmed are still active. This dramatically reduces false positives.

---

## Where Developers Accidentally Put Secrets

| Location | How It Happens | Example |
|----------|---------------|---------|
| `application.yml` / `application.properties` | Developer puts real DB password for "quick testing" | `spring.datasource.password=RealPassword` |
| `.env` file committed to git | Forgot to add `.env` to `.gitignore` | `API_KEY=sk_live_...` |
| Hardcoded in source code | "I'll fix it later" (they won't) | `String apiKey = "real-key-here"` |
| Docker Compose files | Embedded passwords for local dev | `MYSQL_ROOT_PASSWORD=rootpass` |
| CI/CD config files | Build scripts with embedded tokens | `curl -H "Authorization: Bearer ghp_..."` |
| Test files | Using production keys in tests | `const TEST_API_KEY = "real-prod-key"` |
| Git commit messages | Pasting error messages with tokens | `git commit -m "fix: token abc123xyz was wrong"` |
| README / docs | Example config with real values | `export AWS_SECRET_KEY=wJalrXUtn...` |

---

## The Right Way: How to Handle Secrets

### For Spring Boot (Java)

```yaml
# application.yml - WRONG
spring:
  datasource:
    password: MyRealPassword123

# application.yml - RIGHT (use environment variables)
spring:
  datasource:
    password: ${DB_PASSWORD}
```

```bash
# Set the environment variable at deployment time
export DB_PASSWORD=MyRealPassword123

# Or use Spring Profiles
# application-prod.yml loaded from a secure config server
```

### For Node.js (Express)

```javascript
// WRONG - hardcoded
const stripe = require('stripe')('sk_live_real_key_here');

// RIGHT - environment variable
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
```

```bash
# .env file (NEVER commit this)
STRIPE_SECRET_KEY=sk_live_real_key_here

# .gitignore (ALWAYS include this)
.env
.env.*
```

### For Docker Compose

```yaml
# WRONG
services:
  db:
    environment:
      MYSQL_ROOT_PASSWORD: SuperSecret123

# RIGHT - use .env file or Docker secrets
services:
  db:
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
    # Or use Docker secrets:
    secrets:
      - db_password

secrets:
  db_password:
    file: ./secrets/db_password.txt  # Not committed to git
```

### For Jenkins

```groovy
// WRONG - hardcoded in Jenkinsfile
sh 'curl -H "Authorization: Bearer ghp_abc123" ...'

// RIGHT - use Jenkins credentials
withCredentials([string(credentialsId: 'github-token', variable: 'GH_TOKEN')]) {
    sh 'curl -H "Authorization: Bearer ${GH_TOKEN}" ...'
}
```

---

## What To Do When a Secret Is Leaked

### Incident Response Checklist

```
IMMEDIATE (within minutes):
  1. REVOKE/ROTATE the secret immediately
     - AWS: Deactivate the access key in IAM
     - GitHub: Revoke the token in Settings > Tokens
     - Database: Change the password
     - API: Regenerate the API key

  2. Check for unauthorized usage
     - AWS: Check CloudTrail logs
     - GitHub: Check audit log
     - Database: Check query logs

DO NOT just delete the file and push again. The secret is still in git history.

AFTER REVOKING:
  3. Remove from git history (if in a private repo)
     git filter-branch or BFG Repo-Cleaner

  4. Update all systems using the old secret

  5. Add the pattern to your Gitleaks config to prevent recurrence

  6. Post-mortem: How did this happen? What process failed?
```

### Removing Secrets from Git History

```bash
# Option 1: BFG Repo-Cleaner (recommended - faster and simpler)
brew install bfg
bfg --replace-text passwords.txt .   # passwords.txt contains secrets to remove
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Option 2: git filter-repo
pip install git-filter-repo
git filter-repo --invert-paths --path path/to/secret-file
```

**Warning:** This rewrites git history. All team members need to re-clone.

---

## Secrets Detection in Our Pipeline

The secrets scan runs as **Stage 2** - before build, before SAST, before everything else. If credentials are leaked, nothing else matters.

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

**Quality Gate check:**
```groovy
// In the Security Quality Gate stage:
if (fileExists('reports/gitleaks-report.json')) {
    def gitleaksReport = readJSON file: 'reports/gitleaks-report.json'
    if (gitleaksReport instanceof List && gitleaksReport.size() > 0) {
        error("Gitleaks: ${gitleaksReport.size()} secret(s) detected - PIPELINE BLOCKED")
    }
}
```

Any leaked secret = pipeline immediately fails. No exceptions.

---

## Summary

```
Secrets Detection answers: "Did anyone commit a password or API key?"

  Gitleaks:    Fast regex scanning of files + git history
  TruffleHog:  Slower but verifies if secrets are still active

  Pipeline:    Runs FIRST (Stage 2, right after checkout)
  Quality Gate: ANY secret found = pipeline FAILS

  Prevention:
    - Use environment variables, not hardcoded values
    - Use .gitignore to exclude .env files
    - Use Jenkins credentials for CI/CD secrets
    - Pre-commit hooks catch secrets before they enter git history
```

**Next Module:** [04-DAST.md - Dynamic Application Security Testing](./04-DAST.md)
