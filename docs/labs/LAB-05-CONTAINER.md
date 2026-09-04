# Lab 5: Container Security - Dockerfiles and Image Scanning

**Duration:** 15 minutes
**Tools:** Hadolint, Trivy, Docker

---

## Objective

You will:
1. Lint a bad Dockerfile with Hadolint
2. Build and scan a vulnerable image
3. Compare with our hardened Dockerfile
4. Understand the attack surface difference

---

## Part A: Lint a Bad Dockerfile

### Step 1: Create a Bad Dockerfile

Create `docs/labs/vulnerable-samples/Dockerfile.bad`:

```dockerfile
FROM node:latest
RUN apt-get update
RUN apt-get install -y curl wget vim netcat
ADD . /app
WORKDIR /app
RUN npm install
ENV API_KEY=sk_live_abc123def456
EXPOSE 3000 22 8080
CMD npm start
```

### Step 2: Run Hadolint

```bash
# Install
brew install hadolint

# Lint the bad Dockerfile
hadolint docs/labs/vulnerable-samples/Dockerfile.bad
```

**Expected output (multiple warnings/errors):**
```
DL3007 warning: Using latest is prone to errors
DL3008 warning: Pin versions in apt-get install
DL3009 info: Delete the apt-get lists after installing
DL3015 info: Avoid additional packages with apt-get install
DL3020 error: Use COPY instead of ADD for files & folders
DL3002 warning: Last USER should not be root
```

### Step 3: Count the Issues

**Exercise:** For each Hadolint finding, write down:
1. What's the security risk?
2. How would you fix it?

| Rule | Issue | Risk | Fix |
|------|-------|------|-----|
| DL3007 | `:latest` tag | Build breaks randomly | Use specific version tag |
| DL3008 | Unpinned apt packages | Non-reproducible | Pin versions |
| DL3020 | `ADD` instead of `COPY` | ADD can download URLs/extract tars | Use `COPY` |
| DL3002 | Running as root | Container escape = root on host | Add `USER` instruction |
| - | `ENV API_KEY=...` | Secret baked into image | Use runtime env var |
| - | `EXPOSE 22` | SSH in container? Unnecessary | Remove unused ports |
| - | `vim, netcat` | Attack tools in production | Don't install |

### Step 4: Lint Our Good Dockerfile

```bash
hadolint product-service/Dockerfile
hadolint order-service/Dockerfile
```

**Expected:** 0 findings (or only INFO level).

---

## Part B: Build and Scan Images

### Step 1: Build the Bad Image

```bash
# Create a minimal app for the bad Dockerfile
mkdir -p /tmp/bad-app
cp docs/labs/vulnerable-samples/Dockerfile.bad /tmp/bad-app/Dockerfile
echo '{"name":"bad-app","version":"1.0.0","scripts":{"start":"echo hello"}}' > /tmp/bad-app/package.json
echo 'console.log("hello")' > /tmp/bad-app/index.js

docker build -t bad-app:latest /tmp/bad-app/
```

### Step 2: Build Our Good Image

```bash
cd product-service
npm ci  # Need node_modules for the build
docker build -t good-app:latest .
```

### Step 3: Compare Image Sizes

```bash
docker images | grep -E 'bad-app|good-app'

# Expected:
# bad-app    latest    1.1GB   (full Node + apt packages + dev deps)
# good-app   latest    ~150MB  (alpine + production deps only)
```

**The bad image is 7-8x larger!** More packages = more potential vulnerabilities.

### Step 4: Scan Both with Trivy

```bash
# Scan the bad image
echo "=== BAD IMAGE ==="
trivy image --severity HIGH,CRITICAL bad-app:latest 2>/dev/null | tail -20

# Scan the good image
echo "=== GOOD IMAGE ==="
trivy image --severity HIGH,CRITICAL good-app:latest 2>/dev/null | tail -20
```

**Compare:**
- How many HIGH/CRITICAL CVEs in the bad image?
- How many in the good image?
- Where do the extra CVEs come from? (OS packages: curl, wget, vim, etc.)

### Step 5: Check Who's Running

```bash
# Bad image - running as root
docker run --rm bad-app:latest whoami
# Expected: root

# Good image - running as non-root
docker run --rm good-app:latest whoami
# Expected: appuser
```

---

## Part C: Inspect Image Layers

```bash
# See what's in each layer
docker history bad-app:latest
docker history good-app:latest

# See the full image config
docker inspect bad-app:latest | python3 -m json.tool | head -50
docker inspect good-app:latest | python3 -m json.tool | head -50
```

**Look for:**
- `User` field: Is it root or a non-root user?
- `Env`: Are there any secrets in environment variables?
- `ExposedPorts`: Are unnecessary ports exposed?

---

## Part D: Generate SBOM

```bash
# Generate SBOM for the good image
trivy image --format spdx-json --output sbom-good.json good-app:latest

# Count packages
cat sbom-good.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
pkgs = data.get('packages', [])
print(f'Total packages in image: {len(pkgs)}')
os_pkgs = [p for p in pkgs if 'alpine' in p.get('name','').lower() or 'musl' in p.get('name','').lower()]
print(f'OS packages: {len(os_pkgs)}')
print(f'App packages: {len(pkgs) - len(os_pkgs)}')
"
```

---

## Cleanup

```bash
docker rmi bad-app:latest good-app:latest 2>/dev/null
rm -rf /tmp/bad-app
```

---

## Key Takeaways

| Bad Practice | Good Practice | Security Impact |
|-------------|---------------|-----------------|
| `FROM node:latest` | `FROM node:20-alpine` | 10x fewer OS CVEs |
| No `USER` instruction | `USER appuser` | Root → non-root |
| `ADD . /app` | `COPY --chown ...` | No URL downloads, proper ownership |
| `npm install` | `npm ci --only=production` | No dev deps in production |
| `ENV API_KEY=...` | Runtime `--env` or secrets | Secrets not in image layers |
| Install vim, curl | Minimal packages | Smaller attack surface |
