# Lab 3: Secrets Detection - Find Leaked Credentials

**Duration:** 15 minutes
**Tools:** Gitleaks, TruffleHog

---

## Objective

You will:
1. Intentionally commit a "secret" to the repo
2. Run Gitleaks to detect it
3. See how secrets persist in git history even after deletion
4. Practice the incident response workflow

---

## Setup

```bash
# Make sure you're in the project root
cd /path/to/devsecops

# Install Gitleaks
brew install gitleaks
```

---

## Part A: Commit and Detect a Secret

### Step 1: Create a File with a "Secret"

Create a file `order-service/src/main/resources/secret-config.properties`:

```properties
# Database credentials (DO NOT COMMIT!)
db.username=admin
db.password=Pr0duction_P@ss_2024!
aws.access.key=AKIAIOSFODNN7EXAMPLE
aws.secret.key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
stripe.api.key=sk_live_EXAMPLE_KEY_REPLACE_ME
```

### Step 2: Commit It

```bash
git add order-service/src/main/resources/secret-config.properties
git commit -m "add database config"
```

### Step 3: Run Gitleaks

```bash
gitleaks detect --source . --verbose
```

**Expected output:** Gitleaks should find multiple secrets (AWS keys, password, Stripe key).

**Questions:**
1. How many secrets were detected?
2. Which rule IDs matched?
3. What line numbers?

### Step 4: "Fix" It (Delete the File)

```bash
git rm order-service/src/main/resources/secret-config.properties
git commit -m "remove secret config"
```

### Step 5: The Secret is Still in History!

```bash
# The file is gone from the current tree
ls order-service/src/main/resources/secret-config.properties
# File not found

# But Gitleaks still finds it in git history!
gitleaks detect --source . --verbose
# STILL DETECTED!

# See the secret in git history
git log --all --oneline -- order-service/src/main/resources/secret-config.properties
git show HEAD~1:order-service/src/main/resources/secret-config.properties
# The secret is RIGHT THERE
```

**Key lesson:** Deleting a file does NOT remove secrets from git history!

---

## Part B: Using the Allowlist

Sometimes Gitleaks flags things that aren't real secrets (test data, examples).

### Step 1: Check Our Gitleaks Config

```bash
cat security-config/gitleaks.toml
```

### Step 2: Add an Allowlist for Test Files

Edit `security-config/gitleaks.toml` and add:

```toml
[allowlist]
paths = [
    '''test/''',
    '''docs/labs/vulnerable-samples/''',
    '''\.example$''',
]
```

### Step 3: Re-run and Compare

```bash
# Without config (default rules)
gitleaks detect --source . --verbose 2>&1 | head -30

# With our config (allowlist applied)
gitleaks detect --source . --config security-config/gitleaks.toml --verbose 2>&1 | head -30
```

---

## Part C: Pre-commit Hook (Prevention)

### Step 1: Set Up Gitleaks as a Pre-commit Hook

```bash
# Create the hook
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
echo "Running Gitleaks pre-commit check..."
gitleaks protect --staged --config security-config/gitleaks.toml --verbose
if [ $? -ne 0 ]; then
    echo ""
    echo "COMMIT BLOCKED: Secrets detected in staged changes!"
    echo "Remove the secrets and try again."
    exit 1
fi
EOF

chmod +x .git/hooks/pre-commit
```

### Step 2: Test It

```bash
# Create a file with a secret
echo 'API_KEY=sk_live_EXAMPLE_KEY_REPLACE_ME' > test-secret.txt
git add test-secret.txt
git commit -m "test"
# Expected: COMMIT BLOCKED!

# Clean up
git reset HEAD test-secret.txt
rm test-secret.txt
```

**This is how we prevent secrets from ever entering the repository.**

---

## Part D: Incident Response Practice

You've found a real leaked secret. Walk through the response:

### Step 1: Identify
```bash
gitleaks detect --source . --report-path leak-report.json --report-format json
cat leak-report.json | python3 -m json.tool
```

### Step 2: Assess
- What type of secret is it? (AWS key, DB password, API key)
- When was it committed? (check the commit date)
- Who committed it? (check the author)
- Is it for production or development?

### Step 3: Respond
1. **Rotate/Revoke** the credential immediately
2. **Check for unauthorized use** (cloud provider audit logs)
3. **Remove from git history:**
```bash
# Using git filter-repo (install: pip install git-filter-repo)
git filter-repo --invert-paths --path order-service/src/main/resources/secret-config.properties --force
```
4. **Verify removal:**
```bash
gitleaks detect --source . --verbose
# Expected: 0 findings
```

---

## Cleanup

```bash
# Remove the test secret from history
git filter-repo --invert-paths --path order-service/src/main/resources/secret-config.properties --force 2>/dev/null || true
```
