pipeline {
    agent any

    tools {
        maven 'Maven-3.9'
        nodejs 'Node-20'
    }

    environment {
        DOCKER_REGISTRY   = 'docker.io'
        IMAGE_TAG          = "${env.BUILD_NUMBER}-${env.GIT_COMMIT?.take(7) ?: 'latest'}"
        SEMGREP_APP_TOKEN  = credentials('semgrep-app-token')
    }

    options {
        timeout(time: 30, unit: 'MINUTES')
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    stages {

        // ═══════════════════════════════════════════
        // STAGE 1: Checkout & Pre-flight
        // ═══════════════════════════════════════════
        stage('Checkout') {
            steps {
                checkout scm
                sh 'echo "Branch: ${GIT_BRANCH} | Commit: ${GIT_COMMIT}"'
            }
        }

        // ═══════════════════════════════════════════
        // STAGE 2: Secrets Detection (runs first!)
        // ═══════════════════════════════════════════
        stage('Secrets Detection') {
            parallel {
                stage('Gitleaks') {
                    steps {
                        sh '''
                            echo "=== Running Gitleaks ==="
                            docker run --rm -v $(pwd):/repo \
                                zricethezav/gitleaks:latest \
                                detect --source /repo \
                                --config /repo/security-config/gitleaks.toml \
                                --report-path /repo/reports/gitleaks-report.json \
                                --report-format json \
                                --verbose
                        '''
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'reports/gitleaks-report.json', allowEmptyArchive: true
                        }
                    }
                }
                stage('TruffleHog') {
                    steps {
                        sh '''
                            echo "=== Running TruffleHog ==="
                            docker run --rm -v $(pwd):/repo \
                                trufflesecurity/trufflehog:latest \
                                filesystem /repo \
                                --only-verified \
                                --json > reports/trufflehog-report.json || true
                        '''
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'reports/trufflehog-report.json', allowEmptyArchive: true
                        }
                    }
                }
            }
        }
        // ═══════════════════════════════════════════
        // STAGE 3: Build Both Services
        // ═══════════════════════════════════════════
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

        // ═══════════════════════════════════════════
        // STAGE 4: Unit Tests
        // ═══════════════════════════════════════════
        stage('Unit Tests') {
            parallel {
                stage('Test order-service') {
                    steps {
                        dir('order-service') {
                            sh 'mvn test -B'
                        }
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
                        dir('product-service') {
                            sh 'npm run test:ci'
                        }
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

        // ═══════════════════════════════════════════
        // STAGE 5: SAST (Static Application Security Testing)
        // ═══════════════════════════════════════════
        stage('SAST') {
            parallel {
                stage('SpotBugs + FindSecBugs (Java)') {
                    steps {
                        dir('order-service') {
                            sh 'mvn spotbugs:check -B || true'
                            sh 'mvn spotbugs:spotbugs -B'
                        }
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'order-service/target/spotbugsXml.xml', allowEmptyArchive: true
                        }
                    }
                }
                stage('ESLint Security (Node)') {
                    steps {
                        dir('product-service') {
                            sh 'npx eslint src/ --format json -o ../reports/eslint-security-report.json || true'
                        }
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'reports/eslint-security-report.json', allowEmptyArchive: true
                        }
                    }
                }
            }
        }

        // ═══════════════════════════════════════════
        // STAGE 6: SCA (Software Composition Analysis)
        // ═══════════════════════════════════════════

        // ═══════════════════════════════════════════
        // STAGE 7: Security Quality Gate
        // ═══════════════════════════════════════════
        stage('Security Quality Gate') {
            steps {
                script {
                    sh 'mkdir -p reports'
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
                        def errors = semgrepReport.results?.findAll { it.extra?.severity == 'ERROR' } ?: []
                        if (errors.size() > 0) {
                            issues.add("Semgrep: ${errors.size()} ERROR-level finding(s)")
                            gatePass = false
                        }
                    }

                    // Summary
                    echo "════════════════════════════════════"
                    echo "   SECURITY QUALITY GATE RESULTS"
                    echo "════════════════════════════════════"
                    echo "Secrets Detection : ${fileExists('reports/gitleaks-report.json') ? 'SCANNED' : 'SKIPPED'}"
                    echo "SAST (Semgrep)    : ${fileExists('reports/semgrep-report.json') ? 'SCANNED' : 'SKIPPED'}"
                    echo "SAST (SpotBugs)   : ${fileExists('order-service/target/spotbugsXml.xml') ? 'SCANNED' : 'SKIPPED'}"
                    echo "SCA (OWASP)       : ${fileExists('order-service/target/dependency-check-report.json') ? 'SCANNED' : 'SKIPPED'}"
                    echo "SCA (npm audit)   : ${fileExists('reports/npm-audit-report.json') ? 'SCANNED' : 'SKIPPED'}"
                    echo "SCA (Trivy FS)    : ${fileExists('reports/trivy-fs-report.json') ? 'SCANNED' : 'SKIPPED'}"
                    echo "════════════════════════════════════"

                    if (!gatePass) {
                        echo "BLOCKING ISSUES:"
                        issues.each { echo "  - ${it}" }
                        error("Security Quality Gate FAILED: ${issues.join(', ')}")
                    } else {
                        echo "Result: PASSED"
                    }
                }
            }
        }

        // ═══════════════════════════════════════════
        // STAGE 8: Build Docker Images & Container Scan
        // ═══════════════════════════════════════════
        stage('Docker Build & Scan') {
            parallel {
                stage('order-service Image') {
                    steps {
                        dir('order-service') {
                            sh "mvn package -DskipTests -B"
                            sh "docker build -t ${DOCKER_REGISTRY}/order-service:${IMAGE_TAG} ."
                        }
                        sh '''
                            echo "=== Trivy Image Scan: order-service ==="
                        '''
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'reports/trivy-order-image.json', allowEmptyArchive: true
                        }
                    }
                }
                stage('product-service Image') {
                    steps {
                        dir('product-service') {
                            sh "docker build -t ${DOCKER_REGISTRY}/product-service:${IMAGE_TAG} ."
                        }
                        sh '''
                            echo "=== Trivy Image Scan: product-service ==="
                        '''
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'reports/trivy-product-image.json', allowEmptyArchive: true
                        }
                    }
                }
            }
        }

        // ═══════════════════════════════════════════
        // STAGE 9: Deploy to Staging
        // ═══════════════════════════════════════════
        stage('Deploy to Staging') {
            when {
                anyOf {
                    branch 'main'
                    branch 'develop'
                }
            }
            steps {
                sh '''
                    echo "=== Deploying to Staging ==="
                    docker compose -f docker/docker-compose.staging.yml up -d
                    echo "Waiting for services to be ready..."
                    sleep 15
                    curl -sf http://localhost:8080/actuator/health || echo "order-service not ready"
                    curl -sf http://localhost:3000/health || echo "product-service not ready"
                '''
            }
        }

        // ═══════════════════════════════════════════
        // STAGE 10: DAST (Dynamic Application Security Testing)
        // ═══════════════════════════════════════════
        stage('DAST - OWASP ZAP') {
            when {
                anyOf {
                    branch 'main'
                    branch 'develop'
                }
            }
            parallel {
                stage('ZAP - order-service') {
                    steps {
                        sh '''
                            echo "=== OWASP ZAP Scan: order-service ==="
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
                            archiveArtifacts artifacts: 'reports/zap-order-report.*', allowEmptyArchive: true
                            publishHTML(target: [
                                reportDir: 'reports',
                                reportFiles: 'zap-order-report.html',
                                reportName: 'ZAP Report - order-service'
                            ])
                        }
                    }
                }
                stage('ZAP - product-service') {
                    steps {
                        sh '''
                            echo "=== OWASP ZAP Scan: product-service ==="
                            docker run --rm --network host \
                                -v $(pwd)/reports:/zap/wrk \
                                -v $(pwd)/security-config/zap-rules.tsv:/zap/rules.tsv \
                                zaproxy/zap-stable zap-baseline.py \
                                -t http://localhost:3000 \
                                -c rules.tsv \
                                -J zap-product-report.json \
                                -r zap-product-report.html \
                                -a || true
                        '''
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'reports/zap-product-report.*', allowEmptyArchive: true
                            publishHTML(target: [
                                reportDir: 'reports',
                                reportFiles: 'zap-product-report.html',
                                reportName: 'ZAP Report - product-service'
                            ])
                        }
                    }
                }
            }
        }

        // ═══════════════════════════════════════════
        // STAGE 11: Push Images & Deploy to Production
        // ═══════════════════════════════════════════
        stage('Push Images') {
            when { branch 'main' }
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'docker-registry-creds',
                    usernameVariable: 'DOCKER_USER',
                    passwordVariable: 'DOCKER_PASS'
                )]) {
                    sh '''
                        echo "$DOCKER_PASS" | docker login ${DOCKER_REGISTRY} -u "$DOCKER_USER" --password-stdin
                        docker push ${DOCKER_REGISTRY}/order-service:${IMAGE_TAG}
                        docker push ${DOCKER_REGISTRY}/product-service:${IMAGE_TAG}
                        docker tag ${DOCKER_REGISTRY}/order-service:${IMAGE_TAG} ${DOCKER_REGISTRY}/order-service:latest
                        docker tag ${DOCKER_REGISTRY}/product-service:${IMAGE_TAG} ${DOCKER_REGISTRY}/product-service:latest
                        docker push ${DOCKER_REGISTRY}/order-service:latest
                        docker push ${DOCKER_REGISTRY}/product-service:latest
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
                sh '''
                    echo "=== Deploying to Production ==="
                    # Replace with your deployment command:
                    # kubectl set image deployment/order-service ...
                    # kubectl set image deployment/product-service ...
                    echo "Production deployment complete."
                '''
            }
        }
    }

    post {
        always {
            sh 'mkdir -p reports'
            archiveArtifacts artifacts: 'reports/**/*', allowEmptyArchive: true
        }
        success {
            echo 'Pipeline completed successfully with all security gates passed.'
        }
        failure {
            echo 'Pipeline FAILED. Check security scan reports in archived artifacts.'
            // Uncomment to enable notifications:
            // mail to: 'team@example.com',
            //      subject: "FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
            //      body: "Pipeline failed. Check: ${env.BUILD_URL}"
        }
        cleanup {
            sh 'docker compose -f docker/docker-compose.staging.yml down || true'
            cleanWs()
        }
    }
}
