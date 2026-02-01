#!/usr/bin/env python3
"""
On-Demand Project Deployment Orchestrator
==========================================
A secure web application to manage on-demand GCP spot instances for project demos.

Security Features:
- reCAPTCHA Enterprise verification (Google Cloud)
- Recruiter details collection (audit trail)
- GLOBAL rate limiting (max 3 VMs per hour, regardless of IP)
- Single VM at a time (auto-terminate previous)
- CSRF protection
- No user input for commands - all hardcoded
- Request validation
"""

import os
import json
import time
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
import re

# Load environment variables
load_dotenv()

# ============================================
# CONFIGURATION - LOADED FROM ENVIRONMENT
# ============================================

# Google reCAPTCHA Enterprise Configuration
RECAPTCHA_SITE_KEY = os.environ.get("RECAPTCHA_SITE_KEY", "6LegWV0sAAAAAFzlySHz_4EZQXjsRCq4D1F8Un6h")
GCP_PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "dmjone")
RECAPTCHA_API_KEY = os.environ.get("RECAPTCHA_API_KEY", "")  # Google Cloud API Key

# GCP Configuration
GCP_ZONE = os.environ.get("GCP_ZONE", "us-east1-c")
GCP_MACHINE_TYPE = os.environ.get("GCP_MACHINE_TYPE", "e2-micro")
SPOT_INSTANCE_LIFETIME_HOURS = int(os.environ.get("SPOT_INSTANCE_LIFETIME_HOURS", "2"))

# Secret key for Flask sessions
SECRET_KEY = os.environ.get("SECRET_KEY", secrets.token_hex(32))

# Minimum reCAPTCHA score (0.0 to 1.0) - 0.5 is recommended
RECAPTCHA_MIN_SCORE = float(os.environ.get("RECAPTCHA_MIN_SCORE", "0.5"))

# ============================================
# GLOBAL RATE LIMITING - HARD LIMITS
# ============================================

MAX_DEPLOYMENTS_PER_HOUR = 3
DEPLOYMENT_LOG_FILE = "/opt/project-orchestrator/deployment_log.json"

def load_deployment_log():
    """Load deployment timestamps from persistent storage"""
    try:
        if os.path.exists(DEPLOYMENT_LOG_FILE):
            with open(DEPLOYMENT_LOG_FILE, 'r') as f:
                return json.load(f)
    except Exception as e:
        print(f"Error loading deployment log: {e}")
    return {"deployments": [], "recruiters": []}

def save_deployment_log(log_data):
    """Save deployment timestamps to persistent storage"""
    try:
        os.makedirs(os.path.dirname(DEPLOYMENT_LOG_FILE), exist_ok=True)
        with open(DEPLOYMENT_LOG_FILE, 'w') as f:
            json.dump(log_data, f, indent=2)
    except Exception as e:
        print(f"Error saving deployment log: {e}")

def check_global_rate_limit():
    """Check if we've exceeded the global rate limit."""
    log_data = load_deployment_log()
    deployments = log_data.get("deployments", [])
    
    one_hour_ago = (datetime.now() - timedelta(hours=1)).isoformat()
    recent_deployments = [d for d in deployments if d > one_hour_ago]
    
    log_data["deployments"] = recent_deployments
    save_deployment_log(log_data)
    
    remaining = MAX_DEPLOYMENTS_PER_HOUR - len(recent_deployments)
    
    if len(recent_deployments) >= MAX_DEPLOYMENTS_PER_HOUR:
        oldest = min(recent_deployments)
        reset_time = (datetime.fromisoformat(oldest) + timedelta(hours=1)).isoformat()
        return False, 0, reset_time
    
    return True, remaining, None

def record_deployment(recruiter_info):
    """Record a deployment for rate limiting and audit"""
    log_data = load_deployment_log()
    log_data.setdefault("deployments", []).append(datetime.now().isoformat())
    
    recruiter_entry = {
        **recruiter_info,
        "timestamp": datetime.now().isoformat(),
        "ip": request.remote_addr
    }
    log_data.setdefault("recruiters", []).append(recruiter_entry)
    save_deployment_log(log_data)

# ============================================
# RECAPTCHA ENTERPRISE VERIFICATION
# ============================================

def verify_recaptcha_enterprise(token: str, expected_action: str = "DEPLOY") -> tuple[bool, float, str]:
    """
    Verify reCAPTCHA Enterprise token using Google Cloud API.
    
    Returns: (success: bool, score: float, error_message: str)
    """
    if not RECAPTCHA_API_KEY:
        print("Warning: RECAPTCHA_API_KEY not configured")
        return False, 0.0, "reCAPTCHA API key not configured"
    
    try:
        # reCAPTCHA Enterprise API endpoint
        url = f"https://recaptchaenterprise.googleapis.com/v1/projects/{GCP_PROJECT_ID}/assessments?key={RECAPTCHA_API_KEY}"
        
        payload = {
            "event": {
                "token": token,
                "expectedAction": expected_action,
                "siteKey": RECAPTCHA_SITE_KEY
            }
        }
        
        response = requests.post(url, json=payload, timeout=10)
        result = response.json()
        
        # Check for API errors
        if "error" in result:
            error_msg = result.get("error", {}).get("message", "Unknown error")
            print(f"reCAPTCHA Enterprise API error: {error_msg}")
            return False, 0.0, f"API error: {error_msg}"
        
        # Check token validity
        token_properties = result.get("tokenProperties", {})
        if not token_properties.get("valid", False):
            invalid_reason = token_properties.get("invalidReason", "UNKNOWN")
            print(f"Invalid reCAPTCHA token: {invalid_reason}")
            return False, 0.0, f"Invalid token: {invalid_reason}"
        
        # Get risk score (0.0 = likely bot, 1.0 = likely human)
        risk_analysis = result.get("riskAnalysis", {})
        score = risk_analysis.get("score", 0.0)
        reasons = risk_analysis.get("reasons", [])
        
        if reasons:
            print(f"reCAPTCHA risk reasons: {reasons}")
        
        # Check if action matches
        actual_action = token_properties.get("action", "")
        if actual_action != expected_action:
            print(f"reCAPTCHA action mismatch: expected {expected_action}, got {actual_action}")
            return False, score, "Action mismatch"
        
        # Check score threshold
        if score < RECAPTCHA_MIN_SCORE:
            print(f"reCAPTCHA score too low: {score} < {RECAPTCHA_MIN_SCORE}")
            return False, score, f"Score too low ({score:.2f})"
        
        print(f"reCAPTCHA verification passed. Score: {score}")
        return True, score, ""
        
    except requests.exceptions.Timeout:
        return False, 0.0, "Verification timeout"
    except Exception as e:
        print(f"reCAPTCHA Enterprise verification error: {e}")
        return False, 0.0, str(e)

# ============================================
# HARDCODED PROJECTS - NO USER INPUT ALLOWED
# ============================================

def load_project_secrets(project_id):
    """Load additional project-specific secrets from encrypted storage."""
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
    """Get environment variables for a project."""
    project = PROJECTS.get(project_id)
    if not project:
        return {}
    env_vars = project.get("env_vars", {}).copy()
    secret_vars = load_project_secrets(project_id)
    env_vars.update(secret_vars)
    return env_vars

# Instance tracking - only ONE can be active at a time
ACTIVE_INSTANCE = None

# ============================================
# FLASK APP INITIALIZATION
# ============================================

app = Flask(__name__, template_folder='../templates', static_folder='../static')
app.secret_key = SECRET_KEY
csrf = CSRFProtect(app)

limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["100 per hour", "20 per minute"],
    storage_uri="memory://"
)

# ============================================
# VALIDATION FUNCTIONS
# ============================================

def validate_email(email):
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))

def validate_name(name):
    if not name or len(name) < 2 or len(name) > 100:
        return False
    pattern = r'^[a-zA-Z\s\-\.]+$'
    return bool(re.match(pattern, name))

# ============================================
# GCP INSTANCE MANAGEMENT
# ============================================

def generate_startup_script(project_id):
    """Generate startup script for a specific project"""
    project = PROJECTS.get(project_id)
    if not project:
        return None
    
    env_vars = get_project_env_vars(project_id)
    env_vars_str = "\n".join([f'{k}="{v}"' for k, v in env_vars.items()])
    
    startup_script = f'''#!/bin/bash
set -e

# ==========================================
# Auto-generated Startup Script
# Project: {project["name"]}
# Generated: {datetime.now().isoformat()}
# ==========================================

apt-get update
apt-get install -y git nano vim curl

USERNAME="deployer"

if ! id "$USERNAME" &>/dev/null; then
    useradd -m -s /bin/bash "$USERNAME"
    echo "$USERNAME ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/deployer-init
    chmod 440 /etc/sudoers.d/deployer-init
    usermod -aG systemd-journal "$USERNAME"
fi

sudo -u "$USERNAME" bash <<'EOF'
    set -e
    
    USERNAME="deployer"
    USER_HOME="/home/$USERNAME"
    APP_DIR="$USER_HOME/app"
    
    if [ -d "$APP_DIR" ]; then
        rm -rf "$APP_DIR"
    fi

    git clone {project["github_url"]} "$APP_DIR"
    cd "$APP_DIR"

    cat > .env <<EOT
{env_vars_str}
EOT

    chmod +x {project["autoconfig_script"]}
    ./{project["autoconfig_script"]}
EOF

echo "Startup script completed for {project["name"]}"
'''
    return startup_script

def terminate_all_instances():
    """Terminate ALL active demo instances"""
    global ACTIVE_INSTANCE
    
    terminated = []
    
    if ACTIVE_INSTANCE:
        try:
            instance_name = ACTIVE_INSTANCE.get("instance_name")
            if instance_name:
                cmd = [
                    "gcloud", "compute", "instances", "delete", instance_name,
                    f"--project={GCP_PROJECT_ID}",
                    f"--zone={GCP_ZONE}",
                    "--quiet"
                ]
                subprocess.run(cmd, capture_output=True, timeout=60)
                terminated.append(instance_name)
        except Exception as e:
            print(f"Error terminating tracked instance: {e}")
        ACTIVE_INSTANCE = None
    
    # Also cleanup any orphaned demo instances
    try:
        list_cmd = [
            "gcloud", "compute", "instances", "list",
            f"--project={GCP_PROJECT_ID}",
            "--filter=name~^demo-",
            "--format=json"
        ]
        result = subprocess.run(list_cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0 and result.stdout:
            instances = json.loads(result.stdout)
            for inst in instances:
                name = inst.get("name")
                zone = inst.get("zone", "").split("/")[-1]
                if name and name.startswith("demo-"):
                    try:
                        del_cmd = [
                            "gcloud", "compute", "instances", "delete", name,
                            f"--project={GCP_PROJECT_ID}",
                            f"--zone={zone}",
                            "--quiet"
                        ]
                        subprocess.run(del_cmd, capture_output=True, timeout=60)
                        terminated.append(name)
                    except Exception as e:
                        print(f"Error deleting instance {name}: {e}")
    except Exception as e:
        print(f"Error listing instances: {e}")
    
    return terminated

def create_spot_instance(project_id, recruiter_info):
    """Create a new spot instance for a project"""
    global ACTIVE_INSTANCE
    
    project = PROJECTS.get(project_id)
    if not project:
        return {"error": "Invalid project"}
    
    # Terminate any existing instances first
    terminated = terminate_all_instances()
    if terminated:
        print(f"Terminated previous instances: {terminated}")
    
    timestamp = int(time.time())
    instance_name = f"demo-{project_id}-{timestamp}"
    
    startup_script = generate_startup_script(project_id)
    if not startup_script:
        return {"error": "Failed to generate startup script"}
    
    try:
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
        
        instance_info = json.loads(result.stdout)
        if isinstance(instance_info, list):
            instance_info = instance_info[0]
        
        network_interfaces = instance_info.get("networkInterfaces", [])
        external_ip = None
        if network_interfaces:
            access_configs = network_interfaces[0].get("accessConfigs", [])
            if access_configs:
                external_ip = access_configs[0].get("natIP")
        
        expires_at = (datetime.now() + timedelta(hours=SPOT_INSTANCE_LIFETIME_HOURS)).isoformat()
        
        ACTIVE_INSTANCE = {
            "project_id": project_id,
            "instance_name": instance_name,
            "external_ip": external_ip,
            "created_at": datetime.now().isoformat(),
            "expires_at": expires_at,
            "project": project,
            "recruiter": recruiter_info
        }
        
        record_deployment(recruiter_info)
        
        def auto_terminate():
            time.sleep(SPOT_INSTANCE_LIFETIME_HOURS * 3600)
            terminate_all_instances()
        
        threading.Thread(target=auto_terminate, daemon=True).start()
        
        return {
            "success": True,
            "instance_name": instance_name,
            "external_ip": external_ip,
            "port": project["port"],
            "expires_at": expires_at,
            "message": "Instance created. It will be ready in 2-3 minutes."
        }
        
    except subprocess.TimeoutExpired:
        return {"error": "Instance creation timed out"}
    except Exception as e:
        return {"error": str(e)}

def get_active_instance_status():
    """Get status of the currently active instance"""
    global ACTIVE_INSTANCE
    
    if not ACTIVE_INSTANCE:
        return {"status": "not_running", "active_instance": None}
    
    try:
        cmd = [
            "gcloud", "compute", "instances", "describe",
            ACTIVE_INSTANCE["instance_name"],
            f"--project={GCP_PROJECT_ID}",
            f"--zone={GCP_ZONE}",
            "--format=json"
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            ACTIVE_INSTANCE = None
            return {"status": "not_running", "active_instance": None}
        
        instance_data = json.loads(result.stdout)
        gcp_status = instance_data.get("status", "UNKNOWN")
        
        network_interfaces = instance_data.get("networkInterfaces", [])
        external_ip = None
        if network_interfaces:
            access_configs = network_interfaces[0].get("accessConfigs", [])
            if access_configs:
                external_ip = access_configs[0].get("natIP")
        
        ACTIVE_INSTANCE["external_ip"] = external_ip
        
        status_map = {
            "RUNNING": "running",
            "STAGING": "starting",
            "PROVISIONING": "starting",
            "STOPPING": "stopping",
            "TERMINATED": "not_running"
        }
        
        return {
            "status": status_map.get(gcp_status, "unknown"),
            "active_instance": {
                "project_id": ACTIVE_INSTANCE["project_id"],
                "project_name": ACTIVE_INSTANCE["project"]["name"],
                "external_ip": external_ip,
                "port": ACTIVE_INSTANCE["project"]["port"],
                "expires_at": ACTIVE_INSTANCE["expires_at"],
                "created_at": ACTIVE_INSTANCE["created_at"]
            }
        }
        
    except Exception as e:
        print(f"Error getting instance status: {e}")
        return {"status": "error", "error": str(e)}

# ============================================
# API ROUTES
# ============================================

@app.route('/')
def index():
    """Serve the main page"""
    allowed, remaining, reset_time = check_global_rate_limit()
    return render_template('index.html', 
                         projects=PROJECTS,
                         recaptcha_site_key=RECAPTCHA_SITE_KEY,
                         deployments_remaining=remaining,
                         rate_limit_reset=reset_time)

@app.route('/api/projects')
def get_projects():
    """Get all projects with current status"""
    active_status = get_active_instance_status()
    
    projects_with_status = {}
    for project_id, project in PROJECTS.items():
        status = "not_running"
        external_ip = None
        expires_at = None
        
        if active_status.get("active_instance"):
            active = active_status["active_instance"]
            if active["project_id"] == project_id:
                status = active_status["status"]
                external_ip = active.get("external_ip")
                expires_at = active.get("expires_at")
        
        projects_with_status[project_id] = {
            **project,
            "status": status,
            "external_ip": external_ip,
            "expires_at": expires_at
        }
    
    return jsonify(projects_with_status)

@app.route('/api/rate-limit')
def get_rate_limit():
    """Get current rate limit status"""
    allowed, remaining, reset_time = check_global_rate_limit()
    return jsonify({
        "allowed": allowed,
        "remaining": remaining,
        "max_per_hour": MAX_DEPLOYMENTS_PER_HOUR,
        "reset_time": reset_time
    })

@app.route('/api/active-instance')
def get_active():
    """Get the currently active instance"""
    return jsonify(get_active_instance_status())

@app.route('/api/deploy/<project_id>', methods=['POST'])
@limiter.limit("5 per minute")
def deploy_project(project_id):
    """Deploy a project - requires reCAPTCHA Enterprise verification"""
    
    if project_id not in PROJECTS:
        return jsonify({"error": "Invalid project"}), 400
    
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid request"}), 400
    
    # Validate reCAPTCHA Enterprise token
    captcha_token = data.get('captcha_token')
    if not captcha_token:
        return jsonify({"error": "Please complete the security verification"}), 400
    
    success, score, error = verify_recaptcha_enterprise(captcha_token, "DEPLOY")
    if not success:
        return jsonify({"error": f"Security verification failed: {error}"}), 400
    
    # Validate recruiter info
    name = data.get('name', '').strip()
    email = data.get('email', '').strip()
    company = data.get('company', '').strip()
    
    if not validate_name(name):
        return jsonify({"error": "Please enter a valid name (2-100 characters, letters only)"}), 400
    
    if not validate_email(email):
        return jsonify({"error": "Please enter a valid email address"}), 400
    
    # Check global rate limit
    allowed, remaining, reset_time = check_global_rate_limit()
    if not allowed:
        return jsonify({
            "error": f"Demo limit reached. Only {MAX_DEPLOYMENTS_PER_HOUR} demos can be started per hour.",
            "reset_time": reset_time
        }), 429
    
    # Deploy!
    recruiter_info = {
        "name": name,
        "email": email,
        "company": company,
        "recaptcha_score": score
    }
    
    result = create_spot_instance(project_id, recruiter_info)
    
    if "error" in result:
        return jsonify(result), 500
    
    return jsonify(result)

@app.route('/api/terminate', methods=['POST'])
@limiter.limit("10 per minute")
def terminate_current():
    """Terminate the currently active instance"""
    terminated = terminate_all_instances()
    
    if terminated:
        return jsonify({"success": True, "terminated": terminated})
    else:
        return jsonify({"success": True, "message": "No active instances"})

# ============================================
# MAIN
# ============================================

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
