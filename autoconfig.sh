#!/bin/bash
# ============================================
# ON-DEMAND PROJECT DEPLOYMENT ORCHESTRATOR
# FULLY AUTOMATED CONFIGURATION SCRIPT
# ============================================
# Target: always-free-vm (34.75.51.106)
# Zone: us-east1-c
# 
# This script handles EVERYTHING automatically:
# - System updates & dependencies
# - 4GB Swap file creation (for limited RAM)
# - Secure key generation
# - Vault setup with encryption
# - SSL certificate
# - Security hardening
# - Service configuration
#
# NO INTERVENTION REQUIRED
# ============================================

set -e
exec 2>&1  # Redirect stderr to stdout for logging

# ============================================
# CONFIGURATION - DO NOT MODIFY
# ============================================
readonly SCRIPT_VERSION="1.0.0"
readonly APP_DIR="/opt/project-orchestrator"
readonly VAULT_DIR="$APP_DIR/secrets"
readonly LOG_FILE="/var/log/project-orchestrator-setup.log"
readonly SWAP_SIZE="4G"
readonly DOMAIN="projects.dmj.one"
readonly GCP_ZONE="us-east1-c"

# reCAPTCHA Site Key (public - safe to store in code)
readonly RECAPTCHA_SITE_KEY="6LegWV0sAAAAAFzlySHz_4EZQXjsRCq4D1F8Un6h"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ============================================
# LOGGING FUNCTIONS
# ============================================
log() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${BLUE}[$timestamp]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${GREEN}[$timestamp] ✓${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${YELLOW}[$timestamp] ⚠${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "${RED}[$timestamp] ✗${NC} $1" | tee -a "$LOG_FILE"
}

log_section() {
    echo "" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"
    echo "$1" | tee -a "$LOG_FILE"
    echo "========================================" | tee -a "$LOG_FILE"
}

# ============================================
# SECURITY FUNCTIONS
# ============================================
generate_secure_password() {
    # Generate cryptographically secure password
    openssl rand -base64 32 | tr -dc 'a-zA-Z0-9!@#$%^&*' | head -c 32
}

generate_secure_key() {
    # Generate 256-bit key for encryption
    openssl rand -base64 32
}

generate_sha256_hash() {
    echo -n "$1" | sha256sum | cut -d' ' -f1
}

# ============================================
# PREREQUISITE CHECKS
# ============================================
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root"
        echo "Usage: sudo $0"
        exit 1
    fi
}

check_system() {
    log "Checking system requirements..."
    
    # Check if running on Linux
    if [ "$(uname)" != "Linux" ]; then
        log_error "This script only runs on Linux"
        exit 1
    fi
    
    # Check available disk space (need at least 10GB)
    local available_space=$(df -BG / | awk 'NR==2 {print $4}' | tr -d 'G')
    if [ "$available_space" -lt 10 ]; then
        log_warning "Low disk space: ${available_space}GB available"
    fi
    
    log_success "System check passed"
}

# ============================================
# STEP 1: SWAP FILE CREATION
# ============================================
create_swap_file() {
    log_section "STEP 1: Creating ${SWAP_SIZE} Swap File"
    
    local swap_file="/swapfile"
    
    # Check if swap already exists
    if swapon --show | grep -q "$swap_file"; then
        log_warning "Swap file already exists, skipping..."
        return 0
    fi
    
    # Remove existing swap file if present but not active
    if [ -f "$swap_file" ]; then
        log "Removing existing inactive swap file..."
        rm -f "$swap_file"
    fi
    
    log "Allocating ${SWAP_SIZE} swap file (this may take a few minutes)..."
    
    # Create swap file using fallocate (faster) or dd (fallback)
    if command -v fallocate &> /dev/null; then
        fallocate -l "$SWAP_SIZE" "$swap_file"
    else
        dd if=/dev/zero of="$swap_file" bs=1M count=4096 status=progress
    fi
    
    # Secure the swap file
    chmod 600 "$swap_file"
    
    # Set up swap space
    mkswap "$swap_file"
    
    # Enable swap
    swapon "$swap_file"
    
    # Make permanent
    if ! grep -q "$swap_file" /etc/fstab; then
        echo "$swap_file none swap sw 0 0" >> /etc/fstab
    fi
    
    # Optimize swap settings
    echo "vm.swappiness=10" > /etc/sysctl.d/99-swap.conf
    echo "vm.vfs_cache_pressure=50" >> /etc/sysctl.d/99-swap.conf
    sysctl -p /etc/sysctl.d/99-swap.conf
    
    log_success "Swap file created and enabled"
    log "Current memory status:"
    free -h | tee -a "$LOG_FILE"
}

# ============================================
# STEP 2: SYSTEM UPDATE & DEPENDENCIES
# ============================================
install_dependencies() {
    log_section "STEP 2: Installing Dependencies"
    
    log "Updating package lists..."
    apt-get update -qq
    
    log "Upgrading existing packages..."
    DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
    
    log "Installing required packages..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        python3 \
        python3-pip \
        python3-venv \
        nginx \
        certbot \
        python3-certbot-nginx \
        git \
        ufw \
        fail2ban \
        gnupg2 \
        openssl \
        curl \
        jq \
        auditd \
        apparmor \
        apparmor-utils
    
    log_success "All dependencies installed"
}

# ============================================
# STEP 3: GCP CONFIGURATION
# ============================================
configure_gcp() {
    log_section "STEP 3: Configuring GCP"
    
    # Check if gcloud is available
    if ! command -v gcloud &> /dev/null; then
        log "Installing Google Cloud SDK..."
        echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee /etc/apt/sources.list.d/google-cloud-sdk.list
        curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg
        apt-get update -qq && apt-get install -y -qq google-cloud-cli
    fi
    
    # Get project ID
    local project_id=$(curl -s "http://metadata.google.internal/computeMetadata/v1/project/project-id" -H "Metadata-Flavor: Google" 2>/dev/null || echo "")
    
    if [ -n "$project_id" ]; then
        log_success "GCP Project ID: $project_id"
        echo "$project_id" > "$APP_DIR/.gcp_project_id"
    else
        log_warning "Could not detect GCP project ID automatically"
    fi
    
    # Enable required APIs
    log "Enabling required GCP APIs..."
    gcloud services enable compute.googleapis.com --quiet 2>/dev/null || true
    gcloud services enable cloudresourcemanager.googleapis.com --quiet 2>/dev/null || true
    
    # Create firewall rules for demo apps
    log "Configuring firewall rules..."
    gcloud compute firewall-rules create allow-demo-apps \
        --direction=INGRESS \
        --priority=1000 \
        --network=default \
        --action=ALLOW \
        --rules=tcp:3000,tcp:5000,tcp:8080,tcp:8000 \
        --source-ranges=0.0.0.0/0 \
        --target-tags=http-server \
        --quiet 2>/dev/null || log_warning "Firewall rule may already exist"
    
    log_success "GCP configuration complete"
}

# ============================================
# STEP 4: APPLICATION SETUP
# ============================================
setup_application() {
    log_section "STEP 4: Setting Up Application"
    
    # Create application directory
    log "Creating application directory..."
    mkdir -p "$APP_DIR"
    mkdir -p "$APP_DIR/server"
    mkdir -p "$APP_DIR/static/css"
    mkdir -p "$APP_DIR/static/js"
    mkdir -p "$APP_DIR/templates"
    mkdir -p "$VAULT_DIR/keys"
    mkdir -p "$VAULT_DIR/projects"
    mkdir -p "$VAULT_DIR/backups"
    
    # Get the directory where this script is located
    local script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    # Copy application files if running from source AND not already in target
    if [ "$script_dir" != "$APP_DIR" ] && [ -d "$script_dir/server" ]; then
        log "Copying application files from source..."
        cp -r "$script_dir/server"/* "$APP_DIR/server/"
        cp -r "$script_dir/static"/* "$APP_DIR/static/"
        cp -r "$script_dir/templates"/* "$APP_DIR/templates/"
        [ -f "$script_dir/requirements.txt" ] && cp "$script_dir/requirements.txt" "$APP_DIR/"
    else
        log "Files already in place or running from target directory."
    fi
    
    # Create Python virtual environment
    log "Creating Python virtual environment..."
    python3 -m venv "$APP_DIR/venv"
    source "$APP_DIR/venv/bin/activate"
    pip install --upgrade pip -q
    pip install -r "$APP_DIR/requirements.txt" -q 2>/dev/null || pip install Flask Flask-Limiter Flask-WTF requests gunicorn python-dotenv -q
    
    log_success "Application setup complete"
}

# ============================================
# STEP 5: SECURE KEY GENERATION
# ============================================
generate_all_keys() {
    log_section "STEP 5: Generating Secure Keys"
    
    local secrets_file="$APP_DIR/.env"
    local vault_key_file="$VAULT_DIR/keys/vault.key"
    
    # Generate Flask secret key
    log "Generating Flask secret key..."
    local flask_secret=$(generate_secure_key)
    
    # Get GCP project ID
    local gcp_project_id="dmjone"
    if [ -f "$APP_DIR/.gcp_project_id" ]; then
        gcp_project_id=$(cat "$APP_DIR/.gcp_project_id")
    fi
    
    # Create .env file
    log "Creating secure configuration file..."
    cat > "$secrets_file" << EOF
# ============================================
# AUTO-GENERATED CONFIGURATION
# Generated: $(date -Iseconds)
# Version: $SCRIPT_VERSION
# ============================================
# WARNING: This file contains sensitive data
# NEVER commit this file to version control
# ============================================

# Google reCAPTCHA Enterprise Configuration
# Site Key (from GCP Console -> reCAPTCHA Enterprise)
RECAPTCHA_SITE_KEY=$RECAPTCHA_SITE_KEY

# API Key for reCAPTCHA Enterprise (from GCP Console -> APIs & Services -> Credentials)
# Create an API key and restrict it to "reCAPTCHA Enterprise API"
# REQUIRED - Add your API key below:
RECAPTCHA_API_KEY=

# Minimum score threshold (0.0 = bot, 1.0 = human). Default 0.5 recommended.
RECAPTCHA_MIN_SCORE=0.5

# GCP Configuration
GCP_PROJECT_ID=$gcp_project_id
GCP_ZONE=$GCP_ZONE
GCP_MACHINE_TYPE=e2-micro

# Instance Configuration
SPOT_INSTANCE_LIFETIME_HOURS=2

# Flask Configuration
SECRET_KEY=$flask_secret
FLASK_ENV=production

# Server Configuration
HOST=0.0.0.0
PORT=5000
EOF

    # Secure the .env file
    chmod 600 "$secrets_file"
    chown root:root "$secrets_file"
    
    # Store vault key for future encrypted secrets
    if [ -f "$vault_key_file" ]; then
        log "Vault encryption key already exists, preserving..."
    else
        log "Generating vault encryption key..."
        local vault_key=$(generate_secure_key)
        echo "$vault_key" > "$vault_key_file"
        chmod 400 "$vault_key_file"
        chown root:root "$vault_key_file"
        chattr +i "$vault_key_file" 2>/dev/null || true
    fi
    
    log_success "All keys generated securely"
    log_warning "IMPORTANT: Add your RECAPTCHA_API_KEY to $secrets_file"
}

# ============================================
# STEP 6: VAULT SETUP
# ============================================
setup_vault() {
    log_section "STEP 6: Setting Up Secure Vault"
    
    # Set extreme permissions on vault
    
    # Temporarily remove immutable flag from key if it exists
    chattr -i "$VAULT_DIR/keys/vault.key" 2>/dev/null || true
    
    chown -R root:root "$VAULT_DIR"
    
    # Restore immutable flag
    chattr +i "$VAULT_DIR/keys/vault.key" 2>/dev/null || true
    chmod 700 "$VAULT_DIR"
    chmod 700 "$VAULT_DIR/keys"
    chmod 700 "$VAULT_DIR/projects"
    chmod 700 "$VAULT_DIR/backups"
    
    # Remove all ACLs
    setfacl -R -b "$VAULT_DIR" 2>/dev/null || true
    
    # Configure AppArmor if available
    if command -v apparmor_parser &> /dev/null; then
        log "Configuring AppArmor profile..."
        cat > /etc/apparmor.d/project-orchestrator-vault << 'APPARMOR'
#include <tunables/global>

/opt/project-orchestrator/secrets/** {
  # Deny all access by default
  deny /** rwklx,
  
  # Only allow root to read
  owner /** r,
  
  # Deny network access
  deny network,
  
  # Deny capability escalation
  deny capability,
}
APPARMOR
        apparmor_parser -r /etc/apparmor.d/project-orchestrator-vault 2>/dev/null || true
    fi
    
    # Setup audit logging
    if command -v auditctl &> /dev/null; then
        log "Enabling audit logging..."
        auditctl -w "$VAULT_DIR" -p rwxa -k secrets_vault 2>/dev/null || true
    fi
    
    log_success "Vault secured"
}

# ============================================
# STEP 7: SYSTEMD SERVICE
# ============================================
setup_service() {
    log_section "STEP 7: Configuring Systemd Service"
    
    cat > /etc/systemd/system/project-orchestrator.service << EOF
[Unit]
Description=On-Demand Project Deployment Orchestrator
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=$APP_DIR
Environment="PATH=$APP_DIR/venv/bin:/usr/local/bin:/usr/bin:/bin"
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/venv/bin/gunicorn --workers 2 --bind 127.0.0.1:5000 --timeout 120 server.app:app
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=false
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR /dev/shm
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable project-orchestrator
    
    log_success "Systemd service configured"
}

# ============================================
# STEP 8: NGINX CONFIGURATION
# ============================================
setup_nginx() {
    log_section "STEP 8: Configuring Nginx"
    
    cat > /etc/nginx/sites-available/project-orchestrator << EOF
# Rate limiting zone
limit_req_zone \$binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_conn_zone \$binary_remote_addr zone=conn_limit:10m;

# Cloudflare real IP restoration
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
real_ip_header CF-Connecting-IP;

server {
    listen 80;
    server_name $DOMAIN;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Rate limiting
    limit_req zone=api_limit burst=20 nodelay;
    limit_conn conn_limit 10;
    
    # Health check endpoint (no proxy)
    location /health {
        return 200 'OK';
        add_header Content-Type text/plain;
    }
    
    # API endpoints
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
        proxy_connect_timeout 60s;
        proxy_read_timeout 120s;
    }
    
    # Main application
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;
    }
    
    # Static files with caching
    location /static/ {
        alias $APP_DIR/static/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }
    
    # Block sensitive paths
    location ~ /\. {
        deny all;
    }
    
    location ~ ^/(secrets|\.env|\.git) {
        deny all;
        return 404;
    }
}
EOF

    ln -sf /etc/nginx/sites-available/project-orchestrator /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default
    
    nginx -t
    systemctl restart nginx
    
    log_success "Nginx configured"
}

# ============================================
# STEP 9: SECURITY HARDENING
# ============================================
harden_security() {
    log_section "STEP 9: Security Hardening"
    
    # Configure UFW
    log "Configuring firewall..."
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow 22/tcp    # SSH
    ufw allow 80/tcp    # HTTP
    ufw allow 443/tcp   # HTTPS
    ufw --force enable
    
    # Configure Fail2Ban
    log "Configuring Fail2Ban..."
    cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
ignoreip = 127.0.0.1/8

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 86400

[nginx-http-auth]
enabled = true
filter = nginx-http-auth
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 5

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
port = http,https
logpath = /var/log/nginx/error.log
maxretry = 10
EOF

    systemctl restart fail2ban
    systemctl enable fail2ban
    
    # SSH hardening
    log "Hardening SSH..."
    cat > /etc/ssh/sshd_config.d/99-hardening.conf << 'EOF'
PermitRootLogin prohibit-password
PasswordAuthentication no
MaxAuthTries 3
LoginGraceTime 30
PermitEmptyPasswords no
X11Forwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
    
    systemctl restart sshd
    
    # Enable automatic security updates
    log "Configuring automatic updates..."
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades
    dpkg-reconfigure -plow unattended-upgrades 2>/dev/null || true
    
    log_success "Security hardening complete"
}

# ============================================
# STEP 10: SSL CERTIFICATE
# ============================================
setup_ssl() {
    log_section "STEP 10: SSL Certificate"
    
    # Check if domain resolves to this server
    local server_ip=$(curl -s http://checkip.amazonaws.com 2>/dev/null || echo "")
    local domain_ip=$(dig +short "$DOMAIN" 2>/dev/null || echo "")
    
    if [ "$server_ip" = "$domain_ip" ]; then
        log "Domain $DOMAIN resolves correctly to $server_ip"
        log "Requesting SSL certificate..."
        certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@$DOMAIN --redirect 2>/dev/null || {
            log_warning "SSL certificate request failed - you may need to run manually:"
            log_warning "sudo certbot --nginx -d $DOMAIN"
        }
    else
        log_warning "Domain $DOMAIN does not resolve to this server ($server_ip)"
        log_warning "DNS A record: $DOMAIN -> $domain_ip"
        log_warning "Expected: $DOMAIN -> $server_ip"
        log_warning "Please configure DNS and run: sudo certbot --nginx -d $DOMAIN"
    fi
}

# ============================================
# STEP 11: START SERVICES
# ============================================
start_services() {
    log_section "STEP 11: Starting Services"
    
    log "Starting project orchestrator..."
    systemctl start project-orchestrator
    sleep 3
    
    if systemctl is-active --quiet project-orchestrator; then
        log_success "Project orchestrator is running"
    else
        log_error "Failed to start project orchestrator"
        journalctl -u project-orchestrator -n 20 --no-pager
    fi
}

# ============================================
# STEP 12: FINAL SUMMARY
# ============================================
print_summary() {
    log_section "SETUP COMPLETE"
    
    local server_ip=$(curl -s http://checkip.amazonaws.com 2>/dev/null || echo "Unknown")
    
    echo ""
    echo "========================================"
    echo " PROJECT DEMO DEPLOYMENT ORCHESTRATOR"
    echo " Setup Complete!"
    echo "========================================"
    echo ""
    echo "Server Information:"
    echo "  • External IP: $server_ip"
    echo "  • Domain: $DOMAIN"
    echo "  • Zone: $GCP_ZONE"
    echo ""
    echo "Security Status:"
    echo "  • Swap: $(swapon --show | grep -q swapfile && echo 'Enabled (4GB)' || echo 'Not configured')"
    echo "  • Firewall: $(ufw status | grep -q 'active' && echo 'Active' || echo 'Inactive')"
    echo "  • Fail2Ban: $(systemctl is-active fail2ban)"
    echo "  • Rate Limit: 3 VMs per hour (global)"
    echo ""
    echo "Services:"
    echo "  • Orchestrator: $(systemctl is-active project-orchestrator)"
    echo "  • Nginx: $(systemctl is-active nginx)"
    echo ""
    echo "========================================"
    echo " REQUIRED: ADD RECAPTCHA ENTERPRISE API KEY"
    echo "========================================"
    echo ""
    echo "1. Go to GCP Console -> APIs & Services -> Credentials"
    echo "   https://console.cloud.google.com/apis/credentials"
    echo ""
    echo "2. Create an API key and restrict it to:"
    echo "   - 'reCAPTCHA Enterprise API'"
    echo ""
    echo "3. Edit the configuration file:"
    echo "   sudo nano $APP_DIR/.env"
    echo ""
    echo "4. Add your API key to RECAPTCHA_API_KEY="
    echo ""
    echo "5. Restart the service:"
    echo "   sudo systemctl restart project-orchestrator"
    echo ""
    echo "6. Access your application:"
    echo "   http://$DOMAIN (or https:// after SSL)"
    echo ""
    echo "========================================"
    echo ""
    echo "Security Features:"
    echo "  ✓ reCAPTCHA Enterprise (score-based, invisible)"
    echo "  ✓ Recruiter info collection (audit trail)"
    echo "  ✓ Global rate limit: 3 VMs per hour"
    echo "  ✓ Single VM at a time (auto-terminate)"
    echo "  ✓ CSRF protection"
    echo ""
    
    # Log completion
    echo "Setup completed at $(date -Iseconds)" >> "$LOG_FILE"
}

# ============================================
# MAIN EXECUTION
# ============================================
main() {
    # Initialize log
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "======================================" > "$LOG_FILE"
    echo "Setup started at $(date -Iseconds)" >> "$LOG_FILE"
    echo "======================================" >> "$LOG_FILE"
    
    log_section "ON-DEMAND PROJECT DEPLOYMENT ORCHESTRATOR v$SCRIPT_VERSION"
    log "Starting fully automated setup..."
    log "This process takes approximately 5-10 minutes"
    
    # Run all steps
    check_root
    check_system
    create_swap_file
    install_dependencies
    configure_gcp
    setup_application
    generate_all_keys
    setup_vault
    setup_service
    setup_nginx
    harden_security
    setup_ssl
    start_services
    print_summary
}

# Run main function
main "$@"
