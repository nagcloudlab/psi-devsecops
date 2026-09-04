pipeline {
    agent any

    environment {
        JAVA_HOME          = '/usr/lib/jvm/java-21-openjdk-amd64'
        DOCKER_REGISTRY   = 'docker.io'
        IMAGE_TAG          = "${env.BUILD_NUMBER}-${env.GIT_COMMIT?.take(7) ?: 'latest'}"
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
                        sh 'echo "=== [PLACEHOLDER] Gitleaks scan would run here ==="'
                    }
                }
                stage('TruffleHog') {
                    steps {
                        sh 'echo "=== [PLACEHOLDER] TruffleHog scan would run here ==="'
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
                            sh 'java --version'
                            sh 'mvn --version'
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
                        sh 'echo "=== [PLACEHOLDER] SpotBugs + FindSecBugs scan would run here ==="'
                    }
                }
                stage('ESLint Security (Node)') {
                    steps {
                        sh 'echo "=== [PLACEHOLDER] ESLint Security scan would run here ==="'
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
                sh 'echo "=== [PLACEHOLDER] Security Quality Gate check would run here ==="'
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
                        sh 'echo "=== [PLACEHOLDER] Trivy Image Scan: order-service would run here ==="'
                    }
                }
                stage('product-service Image') {
                    steps {
                        dir('product-service') {
                            sh "docker build -t ${DOCKER_REGISTRY}/product-service:${IMAGE_TAG} ."
                        }
                        sh 'echo "=== [PLACEHOLDER] Trivy Image Scan: product-service would run here ==="'
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
                        sh 'echo "=== [PLACEHOLDER] OWASP ZAP Scan: order-service would run here ==="'
                    }
                }
                stage('ZAP - product-service') {
                    steps {
                        sh 'echo "=== [PLACEHOLDER] OWASP ZAP Scan: product-service would run here ==="'
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
        }
        cleanup {
            sh 'docker compose -f docker/docker-compose.staging.yml down || true'
            cleanWs()
        }
    }
}
