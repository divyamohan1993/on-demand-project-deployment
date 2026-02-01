#!/usr/bin/env python3
"""
On-Demand Project Deployment Orchestrator
==========================================
A secure web application to manage on-demand GCP spot instances for project demos.

Security Features:
- CAPTCHA verification (hCaptcha)
- Password protection (hashed)
- Rate limiting
- CSRF protection
- No user input for commands - all hardcoded
- Session management
- Request validation
"""

import os
import json
import time
import hashlib
import secrets
import subprocess
import threading
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, render_template, request, jsonify, session
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_wtf.csrf import CSRFProtect
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ============================================
# CONFIGURATION - LOADED FROM ENVIRONMENT
# ============================================

# Master password hash (SHA-256 of your password)
# Generate with: echo -n "YOUR_PASSWORD" | sha256sum
MASTER_PASSWORD_HASH = os.environ.get("MASTER_PASSWORD_HASH", "")

# Google reCAPTCHA Configuration
RECAPTCHA_SITE_KEY = os.environ.get("RECAPTCHA_SITE_KEY", "6LegWV0sAAAAAFzlySHz_4EZQXjsRCq4D1F8Un6h")
RECAPTCHA_SECRET_KEY = os.environ.get("RECAPTCHA_SECRET_KEY", "")

# GCP Configuration
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "")
GCP_ZONE = os.environ.get("GCP_ZONE", "us-east1-c")  # Match orchestrator VM zone
GCP_MACHINE_TYPE = os.environ.get("GCP_MACHINE_TYPE", "e2-micro")
SPOT_INSTANCE_LIFETIME_HOURS = int(os.environ.get("SPOT_INSTANCE_LIFETIME_HOURS", "2"))

# Secret key for Flask sessions
SECRET_KEY = os.environ.get("SECRET_KEY", secrets.token_hex(32))

# ============================================
# HARDCODED PROJECTS - NO USER INPUT ALLOWED
# Environment variables are embedded securely
# Additional secrets loaded from /opt/project-orchestrator/secrets/
# ============================================

def load_project_secrets(project_id):
    """
    Load additional project-specific secrets from encrypted storage.
    Returns dict of env vars or empty dict if not found.
    """
    secrets_file = f"/opt/project-orchestrator/secrets/projects/{project_id}.env"
    try:
        if os.path.exists(secrets_file):
            env_vars = {}
            with open(secrets_file, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        env_vars[key.strip()] = value.strip().strip('"').strip("'")
            return env_vars
    except Exception as e:
        print(f"Warning: Could not load secrets for {project_id}: {e}")
    return {}

PROJECTS = {
    "setu-voice-ondc": {
        "name": "Setu Voice ONDC Gateway",
        "description": "AI-powered voice interface for ONDC marketplace enabling farmers to list products via voice commands.",
        "github_url": "https://github.com/divyamohan1993/setu-voice-ondc-gateway",
        "autoconfig_script": "autoconfig.sh",
        "port": 3000,
        "env_vars": {
            "PORT": "3000",
            "DATABASE_URL": "file:./dev.db",
            "NODE_ENV": "production",
        },
        "icon": "🎤",
        "category": "AI/ML"
    },
    "cityguard-response-hub": {
        "name": "CityGuard Response Hub",
        "description": "Emergency response coordination system for smart city infrastructure.",
        "github_url": "https://github.com/divyamohan1993/cityguard-response-hub",
        "autoconfig_script": "autoconfig.sh",
        "port": 3000,
        "env_vars": {
            "PORT": "3000",
            "NODE_ENV": "production",
        },
        "icon": "🚨",
        "category": "Smart City"
    },
}

def get_project_env_vars(project_id):
    """
    Get environment variables for a project.
    Loads from secure vault if available, falls back to defaults.
    """
    project = PROJECTS.get(project_id)
    if not project:
        return {}
    
    # Start with defaults
    env_vars = project.get("env_vars", {}).copy()
    
    # Load additional secrets from encrypted storage
    secret_vars = load_project_secrets(project_id)
    env_vars.update(secret_vars)
    
    return env_vars

# Instance tracking (in production, use Redis/database)
ACTIVE_INSTANCES = {}

# ============================================
# FLASK APP INITIALIZATION
# ============================================

app = Flask(__name__, template_folder='../templates', static_folder='../static')
app.secret_key = SECRET_KEY
csrf = CSRFProtect(app)

# Rate limiting
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["100 per hour", "20 per minute"],
    storage_uri="memory://"
)

# ============================================
# SECURITY DECORATORS
# ============================================

def verify_captcha(captcha_response):
    """Verify Google reCAPTCHA response"""
    try:
        response = requests.post(
            "https://www.google.com/recaptcha/api/siteverify",
            data={
                "secret": RECAPTCHA_SECRET_KEY,
                "response": captcha_response
            },
            timeout=10
        )
        result = response.json()
        return result.get("success", False)
    except Exception as e:
        print(f"reCAPTCHA verification error: {e}")
        return False

def verify_password(password):
    """Verify password against stored hash"""
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    return secrets.compare_digest(password_hash, MASTER_PASSWORD_HASH)

def require_auth(f):
    """Decorator to require authentication"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('authenticated'):
            return jsonify({"error": "Authentication required"}), 401
        # Check session expiry (30 minutes)
        if session.get('auth_time'):
            auth_time = datetime.fromisoformat(session['auth_time'])
            if datetime.now() - auth_time > timedelta(minutes=30):
                session.clear()
                return jsonify({"error": "Session expired"}), 401
        return f(*args, **kwargs)
    return decorated_function

# ============================================
# GCP INSTANCE MANAGEMENT
# ============================================

def generate_startup_script(project_id):
    """Generate startup script for a specific project"""
    project = PROJECTS.get(project_id)
    if not project:
        return None
    
    # Load env vars from secure vault (with fallback to defaults)
    env_vars = get_project_env_vars(project_id)
    env_vars_str = "\n".join([f'{k}="{v}"' for k, v in env_vars.items()])
    
    startup_script = f'''#!/bin/bash
set -e

# ==========================================
# Auto-generated Startup Script
# Project: {project["name"]}
# Generated: {datetime.now().isoformat()}
# ==========================================

# System preparation
apt-get update
apt-get install -y git nano vim curl

# Define user
USERNAME="deployer"

# Create user if missing
if ! id "$USERNAME" &>/dev/null; then
    echo "Creating user $USERNAME..."
    useradd -m -s /bin/bash "$USERNAME"
    echo "$USERNAME ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/deployer-init
    chmod 440 /etc/sudoers.d/deployer-init
    usermod -aG systemd-journal "$USERNAME"
fi

# Clone and configure as user
sudo -u "$USERNAME" bash <<'EOF'
    set -e
    
    USERNAME="deployer"
    USER_HOME="/home/$USERNAME"
    APP_DIR="$USER_HOME/app"
    
    # Clean start
    if [ -d "$APP_DIR" ]; then
        rm -rf "$APP_DIR"
    fi

    # Clone the repo
    echo "Cloning repository..."
    git clone {project["github_url"]} "$APP_DIR"
    cd "$APP_DIR"

    # Write environment file
    cat > .env <<EOT
{env_vars_str}
EOT

    # Run deployment
    echo "Starting deployment..."
    chmod +x {project["autoconfig_script"]}
    ./{project["autoconfig_script"]}
EOF

echo "Startup script completed for {project["name"]}"
'''
    return startup_script

def create_spot_instance(project_id):
    """Create a spot VM instance for a project"""
    project = PROJECTS.get(project_id)
    if not project:
        return {"error": "Project not found"}
    
    instance_name = f"demo-{project_id}-{int(time.time())}"
    
    # Generate startup script
    startup_script = generate_startup_script(project_id)
    if not startup_script:
        return {"error": "Failed to generate startup script"}
    
    try:
        # Create instance using gcloud CLI
        cmd = [
            "gcloud", "compute", "instances", "create", instance_name,
            f"--project={GCP_PROJECT_ID}",
            f"--zone={GCP_ZONE}",
            f"--machine-type={GCP_MACHINE_TYPE}",
            "--provisioning-model=SPOT",
            "--instance-termination-action=DELETE",
            "--maintenance-policy=TERMINATE",
            "--image-family=ubuntu-2204-lts",
            "--image-project=ubuntu-os-cloud",
            "--boot-disk-size=10GB",
            "--boot-disk-type=pd-standard",
            f"--metadata=startup-script={startup_script}",
            "--tags=http-server,https-server",
            "--format=json"
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        
        if result.returncode != 0:
            return {"error": f"Failed to create instance: {result.stderr}"}
        
        instance_info = json.loads(result.stdout)[0]
        external_ip = None
        
        # Get external IP
        for interface in instance_info.get("networkInterfaces", []):
            for access in interface.get("accessConfigs", []):
                external_ip = access.get("natIP")
                break
        
        # Track the instance
        ACTIVE_INSTANCES[project_id] = {
            "instance_name": instance_name,
            "external_ip": external_ip,
            "created_at": datetime.now().isoformat(),
            "expires_at": (datetime.now() + timedelta(hours=SPOT_INSTANCE_LIFETIME_HOURS)).isoformat(),
            "status": "starting",
            "project": project
        }
        
        # Schedule auto-deletion
        def auto_delete():
            time.sleep(SPOT_INSTANCE_LIFETIME_HOURS * 3600)
            delete_instance(project_id)
        
        thread = threading.Thread(target=auto_delete, daemon=True)
        thread.start()
        
        return {
            "success": True,
            "instance_name": instance_name,
            "external_ip": external_ip,
            "port": project["port"],
            "expires_at": ACTIVE_INSTANCES[project_id]["expires_at"]
        }
        
    except subprocess.TimeoutExpired:
        return {"error": "Instance creation timed out"}
    except Exception as e:
        return {"error": str(e)}

def delete_instance(project_id):
    """Delete a running instance"""
    if project_id not in ACTIVE_INSTANCES:
        return {"error": "No active instance found"}
    
    instance_info = ACTIVE_INSTANCES[project_id]
    instance_name = instance_info["instance_name"]
    
    try:
        cmd = [
            "gcloud", "compute", "instances", "delete", instance_name,
            f"--project={GCP_PROJECT_ID}",
            f"--zone={GCP_ZONE}",
            "--quiet"
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        if result.returncode == 0:
            del ACTIVE_INSTANCES[project_id]
            return {"success": True}
        else:
            return {"error": f"Failed to delete: {result.stderr}"}
            
    except Exception as e:
        return {"error": str(e)}

def get_instance_status(project_id):
    """Get the status of an instance"""
    if project_id not in ACTIVE_INSTANCES:
        return {"status": "not_running"}
    
    instance_info = ACTIVE_INSTANCES[project_id]
    instance_name = instance_info["instance_name"]
    
    try:
        cmd = [
            "gcloud", "compute", "instances", "describe", instance_name,
            f"--project={GCP_PROJECT_ID}",
            f"--zone={GCP_ZONE}",
            "--format=json"
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            # Instance no longer exists
            if project_id in ACTIVE_INSTANCES:
                del ACTIVE_INSTANCES[project_id]
            return {"status": "not_running"}
        
        gcp_status = json.loads(result.stdout).get("status", "UNKNOWN")
        
        status_map = {
            "RUNNING": "running",
            "STAGING": "starting",
            "PROVISIONING": "starting",
            "STOPPING": "stopping",
            "TERMINATED": "terminated"
        }
        
        return {
            "status": status_map.get(gcp_status, "unknown"),
            "external_ip": instance_info.get("external_ip"),
            "port": instance_info["project"]["port"],
            "expires_at": instance_info["expires_at"]
        }
        
    except Exception as e:
        return {"status": "error", "error": str(e)}

# ============================================
# API ROUTES
# ============================================

@app.route('/')
def index():
    """Serve the main page"""
    return render_template('index.html', 
                         projects=PROJECTS,
                         recaptcha_site_key=RECAPTCHA_SITE_KEY)

@app.route('/api/projects')
def get_projects():
    """Get all projects with their status"""
    projects_with_status = {}
    for project_id, project in PROJECTS.items():
        status = get_instance_status(project_id)
        projects_with_status[project_id] = {
            **project,
            **status
        }
    return jsonify(projects_with_status)

@app.route('/api/auth', methods=['POST'])
@limiter.limit("5 per minute")
def authenticate():
    """Authenticate with CAPTCHA and password"""
    data = request.get_json()
    
    # Validate CAPTCHA
    captcha_response = data.get('captcha_response')
    if not captcha_response:
        return jsonify({"error": "CAPTCHA required"}), 400
    
    if not verify_captcha(captcha_response):
        return jsonify({"error": "CAPTCHA verification failed"}), 400
    
    # Validate password
    password = data.get('password')
    if not password:
        return jsonify({"error": "Password required"}), 400
    
    if not verify_password(password):
        return jsonify({"error": "Invalid password"}), 401
    
    # Set session
    session['authenticated'] = True
    session['auth_time'] = datetime.now().isoformat()
    
    return jsonify({"success": True})

@app.route('/api/instance/<project_id>/start', methods=['POST'])
@limiter.limit("3 per hour")
@require_auth
def start_instance(project_id):
    """Start a new instance for a project"""
    # Validate project_id is in our hardcoded list
    if project_id not in PROJECTS:
        return jsonify({"error": "Invalid project"}), 400
    
    # Check if already running
    if project_id in ACTIVE_INSTANCES:
        status = get_instance_status(project_id)
        if status["status"] in ["running", "starting"]:
            return jsonify({"error": "Instance already running", **status}), 409
    
    result = create_spot_instance(project_id)
    
    if "error" in result:
        return jsonify(result), 500
    
    return jsonify(result)

@app.route('/api/instance/<project_id>/stop', methods=['POST'])
@require_auth
def stop_instance(project_id):
    """Stop and delete an instance"""
    # Validate project_id
    if project_id not in PROJECTS:
        return jsonify({"error": "Invalid project"}), 400
    
    result = delete_instance(project_id)
    
    if "error" in result:
        return jsonify(result), 500
    
    return jsonify(result)

@app.route('/api/instance/<project_id>/status')
def instance_status(project_id):
    """Get instance status"""
    if project_id not in PROJECTS:
        return jsonify({"error": "Invalid project"}), 400
    
    return jsonify(get_instance_status(project_id))

@app.route('/api/logout', methods=['POST'])
def logout():
    """Clear session"""
    session.clear()
    return jsonify({"success": True})

# ============================================
# MAIN
# ============================================

if __name__ == '__main__':
    # Production: use gunicorn
    # Development:
    app.run(host='0.0.0.0', port=5000, debug=False)
