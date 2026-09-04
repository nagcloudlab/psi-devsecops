package com.example.order.controller;

import org.springframework.web.bind.annotation.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.*;
import java.sql.*;

/**
 * INTENTIONALLY VULNERABLE CODE - FOR TRAINING ONLY
 * This file contains 5 security vulnerabilities.
 * DO NOT use this code in production!
 */
@RestController
@RequestMapping("/api/vulnerable/orders")
public class VulnerableOrderController {

    private static final Logger log = LoggerFactory.getLogger(VulnerableOrderController.class);

    // ╔══════════════════════════════════════════════════╗
    // ║ VULNERABILITY 1: Hardcoded credentials (CWE-798)║
    // ╚══════════════════════════════════════════════════╝
    private static final String DB_URL = "jdbc:mysql://prod-db:3306/orders";
    private static final String DB_USER = "admin";
    private static final String DB_PASSWORD = "Super$ecret_Pr0d_2024!";

    // ╔══════════════════════════════════════════════════╗
    // ║ VULNERABILITY 2: SQL Injection (CWE-89)         ║
    // ╚══════════════════════════════════════════════════╝
    @GetMapping("/search")
    public String searchOrders(@RequestParam String customerName) {
        try {
            Connection conn = DriverManager.getConnection(DB_URL, DB_USER, DB_PASSWORD);
            // BAD: String concatenation in SQL query
            String query = "SELECT * FROM orders WHERE customer_name = '" + customerName + "'";
            Statement stmt = conn.createStatement();
            ResultSet rs = stmt.executeQuery(query);
            // An attacker can send: customerName = "'; DROP TABLE orders; --"
            return rs.toString();
        } catch (SQLException e) {
            return e.getMessage(); // Also bad: leaking SQL error details
        }
    }

    // ╔══════════════════════════════════════════════════╗
    // ║ VULNERABILITY 3: Log Injection (CWE-117)        ║
    // ╚══════════════════════════════════════════════════╝
    @PostMapping("/login")
    public String login(@RequestParam String username) {
        // BAD: User input directly in log message
        // Attacker sends: username = "admin\n2024-01-01 INFO Login successful for admin"
        // This creates a fake log entry!
        log.info("Login attempt for user: " + username);
        return "Login processed";
    }

    // ╔══════════════════════════════════════════════════════════╗
    // ║ VULNERABILITY 4: Insecure Deserialization (CWE-502)     ║
    // ╚══════════════════════════════════════════════════════════╝
    @PostMapping("/import")
    public String importOrder(InputStream requestBody) {
        try {
            // BAD: Deserializing untrusted data
            // Attacker can send a crafted serialized object that executes arbitrary code
            ObjectInputStream ois = new ObjectInputStream(requestBody);
            Object order = ois.readObject();
            return "Imported: " + order.toString();
        } catch (Exception e) {
            return "Error: " + e.getMessage();
        }
    }

    // ╔══════════════════════════════════════════════════╗
    // ║ VULNERABILITY 5: Missing Input Validation       ║
    // ║                  (CWE-20)                       ║
    // ╚══════════════════════════════════════════════════╝
    @PostMapping
    public String createOrder(@RequestBody OrderRequest request) {
        // BAD: No validation at all
        // - quantity could be negative (buy -100 items = get refund?)
        // - productId could be empty
        // - totalPrice could be manipulated by the client
        return "Order created for product: " + request.productId
             + " qty: " + request.quantity
             + " price: " + request.totalPrice;
    }

    static class OrderRequest {
        public String productId;  // No @NotBlank
        public int quantity;      // No @Min(1)
        public double totalPrice; // Should be calculated server-side, not sent by client!
    }
}

/*
 * ═══════════════════════════════════════════
 * FIXES (try to fix them yourself first!)
 * ═══════════════════════════════════════════
 *
 * Fix 1 (Hardcoded creds):
 *   @Value("${spring.datasource.password}")
 *   private String dbPassword;
 *
 * Fix 2 (SQL Injection):
 *   PreparedStatement ps = conn.prepareStatement(
 *       "SELECT * FROM orders WHERE customer_name = ?");
 *   ps.setString(1, customerName);
 *   ResultSet rs = ps.executeQuery();
 *
 * Fix 3 (Log Injection):
 *   String safeUsername = username.replaceAll("[\\r\\n]", "_");
 *   log.info("Login attempt for user: {}", safeUsername);
 *
 * Fix 4 (Insecure Deserialization):
 *   ObjectMapper mapper = new ObjectMapper();
 *   Order order = mapper.readValue(requestBody, Order.class);
 *
 * Fix 5 (Missing Validation):
 *   public String createOrder(@Valid @RequestBody OrderRequest request)
 *   Add: @NotBlank on productId, @Min(1) on quantity
 *   Remove: totalPrice from request (calculate server-side)
 */
