# Module 2: SAST - Static Application Security Testing

---

## What is SAST?

SAST analyzes your **source code** without executing it. It reads your Java and JavaScript files and looks for patterns that are known to be vulnerable.

**Analogy:** SAST is like a spell-checker for security. Just as a spell-checker reads your text and finds misspelled words, SAST reads your code and finds insecure patterns.

```
                 Your Source Code
                       |
                       v
              +------------------+
              |   SAST Scanner   |
              |                  |
              |  Reads code      |
              |  Matches against |
              |  known-bad       |
              |  patterns/rules  |
              +------------------+
                       |
                       v
              "Line 42: SQL Injection found"
              "Line 87: Hardcoded password"
              "Line 103: XSS vulnerability"
```

**Key characteristic:** SAST does NOT run your application. It analyzes the code statically (like reading a book vs watching the movie).

---

## Why SAST Matters

| Without SAST | With SAST |
|-------------|-----------|
| Developer writes SQL injection | Scanner catches it in the PR |
| Code review might miss subtle XSS | Automated, consistent detection |
| Vulnerability reaches production | Vulnerability blocked at build time |
| Discovered during a penetration test (expensive) | Discovered in 2 minutes during CI |

---

## SAST Tools in Our Pipeline

We use 3 SAST tools because each has different strengths:

| Tool | Language | Strengths | Weaknesses |
|------|----------|-----------|------------|
| **Semgrep** | Java, JS, Python, Go, etc. | Fast, easy custom rules, OWASP/CWE rule packs | Fewer deep data-flow rules than CodeQL |
| **SpotBugs + FindSecBugs** | Java only | Deep bytecode analysis, excellent Java-specific security rules | Only works for Java, needs compiled code |
| **ESLint + Security Plugin** | JavaScript/Node only | Integrated into Node dev workflow, catches Node-specific issues | Only for JS, limited to what ESLint can parse |

---

## Tool 1: Semgrep (Both Java and Node)

### What is Semgrep?

Semgrep is a fast, open-source SAST tool that matches code patterns. Think of it as "grep for code structure" - but instead of matching text, it matches code patterns.

### How Semgrep Works

Semgrep uses **rules** that describe vulnerable code patterns:

```yaml
# This is a Semgrep rule
rules:
  - id: sql-injection-concatenation
    pattern: |
      String $QUERY = "..." + $INPUT;     # <-- matches this pattern
    message: "Possible SQL injection via string concatenation"
    severity: ERROR
```

When Semgrep scans your code, it looks for anything matching that pattern:

```java
// This would be FLAGGED:
String query = "SELECT * FROM users WHERE id = " + userId;

// This would NOT be flagged (parameterized - safe):
PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?");
ps.setString(1, userId);
```

### Semgrep Rule Packs

Semgrep comes with pre-built rule packs. We use these in our pipeline:

| Rule Pack | What It Checks | # of Rules |
|-----------|---------------|------------|
| `--config auto` | Auto-detects language, applies relevant rules | Varies |
| `--config p/owasp-top-ten` | All OWASP Top 10 vulnerability patterns | ~200 |
| `--config p/cwe-top-25` | Top 25 most dangerous software weaknesses | ~150 |

### Running Semgrep Locally

```bash
# Install
pip install semgrep
# or
brew install semgrep

# Scan the entire project
semgrep --config auto .

# Scan with OWASP rules
semgrep --config p/owasp-top-ten .

# Scan only Java files
semgrep --config auto --lang java order-service/

# Scan only JavaScript files
semgrep --config auto --lang javascript product-service/

# Output JSON report
semgrep --config auto --json --output report.json .

# Only show errors (not warnings)
semgrep --config auto --severity ERROR .
```

### Semgrep in Our Jenkins Pipeline

From our `Jenkinsfile`:

```groovy
stage('Semgrep') {
    steps {
        sh '''
            docker run --rm -v $(pwd):/src \
                semgrep/semgrep:latest semgrep ci \
                --config auto \
                --config p/owasp-top-ten \
                --config p/cwe-top-25 \
                --json --output /src/reports/semgrep-report.json \
                --severity WARNING \
                --severity ERROR
        '''
    }
}
```

**What this does:**
1. Runs Semgrep in a Docker container (no installation needed on Jenkins)
2. Mounts the project code into the container (`-v $(pwd):/src`)
3. Uses auto-detection + OWASP + CWE rule packs
4. Outputs a JSON report for the security quality gate to check
5. Only reports WARNING and ERROR severity (ignores INFO)

### What Semgrep Catches - Java Examples

**1. SQL Injection (CWE-89)**

```java
// VULNERABLE - Semgrep flags this
@GetMapping("/search")
public List<Order> search(@RequestParam String name) {
    String query = "SELECT * FROM orders WHERE name = '" + name + "'";
    return jdbcTemplate.queryForList(query);
}

// SAFE - Semgrep does NOT flag this
@GetMapping("/search")
public List<Order> search(@RequestParam String name) {
    String query = "SELECT * FROM orders WHERE name = ?";
    return jdbcTemplate.queryForList(query, name);
}
```

**Why it's dangerous:** An attacker could send `name = "'; DROP TABLE orders; --"` and delete your entire table.

**2. Hardcoded Credentials (CWE-798)**

```java
// VULNERABLE - Semgrep flags this
public class DatabaseConfig {
    private String password = "SuperSecret123!";
    private String apiKey = "sk-1234567890abcdef";
}

// SAFE - use environment variables
public class DatabaseConfig {
    @Value("${db.password}")
    private String password;
}
```

**3. Insecure Deserialization (CWE-502)**

```java
// VULNERABLE - Semgrep flags this
ObjectInputStream ois = new ObjectInputStream(request.getInputStream());
Object obj = ois.readObject();  // Attacker can send malicious serialized objects

// SAFE - use JSON instead
ObjectMapper mapper = new ObjectMapper();
Order order = mapper.readValue(request.getInputStream(), Order.class);
```

### What Semgrep Catches - Node.js Examples

**1. Cross-Site Scripting / XSS (CWE-79)**

```javascript
// VULNERABLE - Semgrep flags this
app.get('/user', (req, res) => {
    res.send(`<h1>Hello ${req.query.name}</h1>`);  // User input directly in HTML
});

// SAFE - use a template engine with auto-escaping
app.get('/user', (req, res) => {
    res.render('user', { name: req.query.name });  // Template engine escapes it
});
```

**2. Path Traversal (CWE-22)**

```javascript
// VULNERABLE - Semgrep flags this
app.get('/file', (req, res) => {
    const filePath = './uploads/' + req.query.filename;
    res.sendFile(filePath);  // Attacker sends filename=../../etc/passwd
});

// SAFE - validate and sanitize
const path = require('path');
app.get('/file', (req, res) => {
    const safePath = path.join(__dirname, 'uploads', path.basename(req.query.filename));
    res.sendFile(safePath);
});
```

**3. Command Injection (CWE-78)**

```javascript
// VULNERABLE - Semgrep flags this
const { exec } = require('child_process');
app.get('/ping', (req, res) => {
    exec(`ping -c 1 ${req.query.host}`, (err, stdout) => {  // host=; rm -rf /
        res.send(stdout);
    });
});

// SAFE - use execFile with arguments array
const { execFile } = require('child_process');
app.get('/ping', (req, res) => {
    execFile('ping', ['-c', '1', req.query.host], (err, stdout) => {
        res.send(stdout);
    });
});
```

### Writing Custom Semgrep Rules

You can write rules specific to your project. Our custom rules are in `.semgrep.yml`:

```yaml
rules:
  # Rule 1: Catch hardcoded passwords in any language
  - id: hardcoded-password
    patterns:
      - pattern: |
          $VAR = "..."
      - metavariable-regex:
          metavariable: $VAR
          regex: (?i)(password|passwd|secret|token|api_key)
    message: >
      Hardcoded credential in variable '$VAR'.
      Use environment variables or a secrets manager.
    languages: [javascript, typescript, python, java, go]
    severity: ERROR
    metadata:
      cwe: "CWE-798"
      owasp: "A07:2021"
```

**Breaking down the rule:**
- `patterns`: Defines what code structure to match
- `metavariable-regex`: Further filters - the variable name must contain "password", "secret", etc.
- `severity: ERROR`: This will fail the pipeline (our quality gate checks for ERRORs)
- `metadata.cwe`: Maps to the CWE standard for reporting

---

## Tool 2: SpotBugs + FindSecBugs (Java Only)

### What is SpotBugs?

SpotBugs analyzes **compiled Java bytecode** (not source code). It's deeper than Semgrep for Java because it understands the full type system and data flow.

**FindSecBugs** is a SpotBugs plugin that adds 150+ security-specific rules.

### How It Differs from Semgrep

```
Semgrep:                          SpotBugs + FindSecBugs:
- Reads source code (.java)       - Reads bytecode (.class)
- Pattern matching                 - Data flow analysis
- Works before compilation         - Requires compiled code
- Multi-language                   - Java/Kotlin only
- Fast (~seconds)                  - Slower (~minutes)
```

**Why use both?** They catch different things:
- Semgrep catches pattern-based issues (hardcoded secrets, dangerous API usage)
- SpotBugs catches data-flow issues (tainted input flowing to a SQL query through 5 method calls)

### Configuration in pom.xml

From our `order-service/pom.xml`:

```xml
<plugin>
    <groupId>com.github.spotbugs</groupId>
    <artifactId>spotbugs-maven-plugin</artifactId>
    <version>4.8.4.0</version>
    <configuration>
        <effort>Max</effort>           <!-- Most thorough analysis -->
        <threshold>Medium</threshold>  <!-- Report Medium+ findings -->
        <plugins>
            <plugin>
                <groupId>com.h3xstream.findsecbugs</groupId>
                <artifactId>findsecbugs-plugin</artifactId>
                <version>1.13.0</version>
            </plugin>
        </plugins>
    </configuration>
</plugin>
```

**Configuration explained:**
- `effort=Max`: Tells SpotBugs to do the most thorough (but slowest) analysis
- `threshold=Medium`: Report anything Medium severity or above
- `findsecbugs-plugin`: Adds the security-specific detection rules

### Running SpotBugs Locally

```bash
cd order-service

# Compile first (SpotBugs needs bytecode)
mvn compile

# Run SpotBugs analysis
mvn spotbugs:check        # Fails build on findings
mvn spotbugs:spotbugs     # Generates report only
mvn spotbugs:gui          # Opens interactive GUI to browse findings
```

### What SpotBugs + FindSecBugs Catches

**1. SQL Injection via data flow tracking**

```java
// FindSecBugs traces the data flow:
// request.getParameter() --> variable --> string concat --> SQL query
@GetMapping("/orders")
public List<Order> getOrders(HttpServletRequest request) {
    String status = request.getParameter("status");        // SOURCE (user input)
    String sortBy = request.getParameter("sort");           // SOURCE (user input)
    String query = "SELECT * FROM orders WHERE status = '"
                   + status + "' ORDER BY " + sortBy;       // SINK (SQL execution)
    return jdbcTemplate.queryForList(query, Order.class);   // FLAGGED!
}
```

FindSecBugs reports: `SQL_INJECTION` - The tainted input flows from `getParameter()` to the SQL query.

**2. Insecure Random Number Generation**

```java
// FLAGGED by FindSecBugs
Random random = new Random();
String token = String.valueOf(random.nextLong());  // Predictable!

// SAFE
SecureRandom secureRandom = new SecureRandom();
String token = String.valueOf(secureRandom.nextLong());
```

**3. XXE (XML External Entity) Injection**

```java
// FLAGGED by FindSecBugs
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
DocumentBuilder builder = factory.newDocumentBuilder();
Document doc = builder.parse(request.getInputStream());  // XXE!

// SAFE - disable external entities
DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
```

### SpotBugs in Our Jenkins Pipeline

```groovy
stage('SpotBugs + FindSecBugs (Java)') {
    steps {
        dir('order-service') {
            sh 'mvn spotbugs:check -B || true'   // Don't fail immediately
            sh 'mvn spotbugs:spotbugs -B'        // Generate report
        }
    }
    post {
        always {
            archiveArtifacts artifacts: 'order-service/target/spotbugsXml.xml',
                             allowEmptyArchive: true
        }
    }
}
```

---

## Tool 3: ESLint Security Plugin (Node.js Only)

### What is ESLint Security?

ESLint is the standard JavaScript linter. The `eslint-plugin-security` adds rules that detect security anti-patterns specific to Node.js.

### Configuration

From `product-service/.eslintrc.json`:

```json
{
  "extends": ["eslint:recommended", "plugin:security/recommended-legacy"],
  "plugins": ["security"],
  "rules": {
    "security/detect-object-injection": "warn",
    "security/detect-non-literal-regexp": "error",
    "security/detect-eval-with-expression": "error",
    "security/detect-no-csrf-before-method-override": "error",
    "no-eval": "error",
    "no-implied-eval": "error"
  }
}
```

### ESLint Security Rules Explained

| Rule | What It Catches | Severity |
|------|----------------|----------|
| `detect-eval-with-expression` | `eval(userInput)` - code injection | ERROR |
| `detect-non-literal-regexp` | `new RegExp(userInput)` - ReDoS attacks | ERROR |
| `detect-object-injection` | `obj[userInput]` - prototype pollution | WARN |
| `detect-no-csrf-before-method-override` | CSRF bypass via method override | ERROR |
| `detect-possible-timing-attacks` | `if (secret === userInput)` - timing attacks | WARN |
| `detect-child-process` | `exec(userInput)` - command injection | WARN |
| `detect-unsafe-regex` | Regex patterns vulnerable to ReDoS | WARN |

### Examples

**1. eval() with user input (Code Injection)**

```javascript
// FLAGGED by eslint-plugin-security
app.post('/calculate', (req, res) => {
    const result = eval(req.body.expression);  // Attacker sends: require('child_process').exec('rm -rf /')
    res.json({ result });
});

// SAFE - use a proper math parser
const math = require('mathjs');
app.post('/calculate', (req, res) => {
    const result = math.evaluate(req.body.expression);
    res.json({ result });
});
```

**2. Non-literal RegExp (ReDoS)**

```javascript
// FLAGGED - user controls the regex pattern
app.get('/search', (req, res) => {
    const pattern = new RegExp(req.query.pattern);  // ReDoS attack!
    const results = data.filter(item => pattern.test(item.name));
    res.json(results);
});

// SAFE - escape special characters or use string matching
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
app.get('/search', (req, res) => {
    const pattern = new RegExp(escapeRegExp(req.query.pattern));
    const results = data.filter(item => pattern.test(item.name));
    res.json(results);
});
```

### Running ESLint Locally

```bash
cd product-service

# Run ESLint with security rules
npx eslint src/

# Output as JSON
npx eslint src/ --format json -o eslint-report.json

# Auto-fix what can be fixed
npx eslint src/ --fix
```

---

## SAST Results: Reading and Triaging

When SAST tools produce findings, you need to evaluate each one:

### Triage Workflow

```
Finding reported
      |
      v
Is it a TRUE POSITIVE? ----No----> Mark as false positive, add to ignore list
      |
     Yes
      |
      v
Is it CRITICAL/HIGH? ------No----> Add to backlog, fix in next sprint
      |
     Yes
      |
      v
Fix it NOW (blocks deployment)
```

### Common False Positives

| Scenario | Why It's False | How to Handle |
|----------|---------------|---------------|
| Test file has hardcoded "password" | It's test data, not a real secret | Exclude test directories |
| `localhost` flagged as insecure HTTP | It's local development | Add to allowlist |
| `Math.random()` flagged as insecure | Used for non-security purposes (UI) | Suppress with comment |

### Suppressing False Positives

**Semgrep:**
```java
// nosemgrep: hardcoded-password
String testPassword = "test123";  // This is only used in unit tests
```

**SpotBugs:**
```java
@SuppressFBWarnings(value = "SQL_INJECTION",
    justification = "Query uses only internal constants, no user input")
public List<String> getStaticReport() { ... }
```

**ESLint:**
```javascript
// eslint-disable-next-line security/detect-object-injection
const value = config[knownSafeKey];  // Key is from internal enum, not user input
```

**Important:** Always document WHY you're suppressing a finding. Never suppress without justification.

---

## Summary

| Tool | Language | Runs On | Best At |
|------|----------|---------|---------|
| Semgrep | All | Source code | Pattern matching, OWASP rules, fast feedback |
| SpotBugs + FindSecBugs | Java | Bytecode | Deep data-flow analysis, Java-specific security |
| ESLint Security | Node.js | Source code | Node-specific patterns, integrated in dev workflow |

**Next Module:** [02-SCA.md - Software Composition Analysis](./02-SCA.md)
