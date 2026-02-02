# 🚀 On-Demand Project Deployment Orchestrator

A **secure, fully automated** system for deploying project demos on Google Cloud Platform. Deploy temporary spot instances with a single click, protected by reCAPTCHA Enterprise and strict rate limiting.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.8+-green.svg)
![GCP](https://img.shields.io/badge/GCP-Free%20Tier-orange.svg)

## ✨ Features

- **One-Click Deployment** - Deploy any project with a single click
- **Recruiter Friendly** - No passwords required! Just Name & Email (audit trail)
- **Advanced Bot Protection** - Google reCAPTCHA Enterprise (score-based, invisible)
- **Waitlist Management** - Global limit of **3 VMs per hour** to prevent abuse
- **Cost Control** - Strict "One VM at a time" policy (existing VM is auto-killed)
- **Zero Configuration** - `autoconfig.sh` handles everything automatically
- **Cloudflare Ready** - Supports Flexible SSL mode (Cloudflare handles HTTPS)

## 🏗️ Architecture

```mermaid
graph TD
    User[Recruiter] -->|HTTPS| CF[Cloudflare Proxy]
    CF -->|HTTP + Headers| VM[Orchestrator VM]
    VM -->|Validate| ReCAPTCHA[Google reCAPTCHA Enterprise]
    VM -->|Launch| Spot[Spot Instance (2 Hours)]
    
    subgraph Security Layer
    ReCAPTCHA
    Audit[Audit Log]
    Rate[Global Rate Limit]
    end
```

## 🔒 Security Model

| Layer | Implementation |
|-------|----------------|
| **Validation** | reCAPTCHA Enterprise (Score 0.0 - 1.0) |
| **Audit Trail** | Logs Recruiter Name, Email, IP, Company |
| **Rate Limiting** | **3 VMs per hour (Global)** + 5/min per IP |
| **Concurrency** | **Max 1 Active VM** (New kills Old) |
| **Network** | Cloudflare Flexible SSL (Hides Server IP) |
| **System** | UFW Firewall, Fail2Ban, Non-root execution |

## 🚀 Deployment Guide

### Prerequisites

1.  **GCP Account** with an always-free VM instance (`e2-micro`).
2.  **Domain Name** managed by Cloudflare.
3.  **Google Cloud Project** with "reCAPTCHA Enterprise API" enabled.

### Step 1: GCP VM Setup

1.  Create an `e2-micro` instance in `us-east1`, `us-west1`, or `us-central1`.
2.  OS: Ubuntu 22.04 LTS x86/64.
3.  Allow HTTP/HTTPS traffic.

### Step 2: One-Command Installation

SSH into your VM and run:

```bash
# Clone the repository
git clone https://github.com/divyamohan1993/on-demand-project-deployment.git /opt/project-orchestrator
cd /opt/project-orchestrator

# Run the auto-configuration script
sudo chmod +x autoconfig.sh
sudo ./autoconfig.sh
```

The script will:
- ✅ Create a 4GB Swap file (critical for `e2-micro`)
- ✅ Install Python, Nginx, Gunicorn, and dependencies
- ✅ Configure Nginx for Cloudflare Flexible SSL
- ✅ Set up systemd services and security hardening

### Step 3: Configure reCAPTCHA Enterprise

1.  Go to **[Google Cloud Console > Security > reCAPTCHA Enterprise](https://console.cloud.google.com/security/recaptcha)**.
2.  Create a Key for your domain (e.g., `projects.dmj.one`).
    -   **Integration type**: Scoring (no checkbox).
    -   Copy the **Site Key**.
3.  Go to **[APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials)**.
4.  Create an **API Key**.
    -   Restrict key to "reCAPTCHA Enterprise API".
    -   Copy the **API Key**.
5.  Update your environment file:

```bash
sudo nano /opt/project-orchestrator/.env
```

Add your keys:
```ini
RECAPTCHA_SITE_KEY=your_site_key_here
RECAPTCHA_API_KEY=your_api_key_here
```

Restart the service:
```bash
sudo systemctl restart project-orchestrator
```

### Step 4: Cloudflare Setup (Important!)

1.  Go to **Cloudflare Dashboard > SSL/TLS**.
2.  Set SSL/TLS encryption mode to **Flexible** (or Full if you have a cert, but Flexible is easiest).
3.  Go to **DNS** and ensure your domain is proxied (Orange Cloud).

---

## 🔧 Management

### View Logs
```bash
# Application logs (deployments, errors)
sudo journalctl -u project-orchestrator -f

# Access logs (Nginx)
sudo tail -f /var/log/nginx/access.log
```

### Restart Services
```bash
sudo systemctl restart project-orchestrator
sudo systemctl reload nginx
```

### Check Rate Limits manually
```bash
cat /opt/project-orchestrator/deployment_log.json
```

---

## ➕ Adding Projects

Edit `server/app.py` and add to the `PROJECTS` dictionary:

```python
PROJECTS = {
    "my-project": {
        "name": "My Cool App",
        "description": "Short description shown on card",
        "github_url": "https://github.com/user/repo",
        "autoconfig_script": "autoconfig.sh",  # Script in your repo root
        "port": 3000,
        "env_vars": { "NODE_ENV": "production" },
        "icon": "🚀",
        "category": "Web App"
    }
}
```

**Project Requirements:**
- The target repo must have an executable `autoconfig.sh` (or specified script).
- The script must start the server on the specified port.

---

## 💰 Cost Analysis

| Component | Cost | Notes |
|-----------|------|-------|
| **Orchestrator VM** | FREE | Always-free tier `e2-micro` |
| **Spot VM** | ~$0.007/hr | Only runs when requested |
| **Bandwidth** | FREE | Within free tier limits |
| **Total** | **<$1.00/mo** | Assuming ~5 demos/day |

---

## 🐛 Troubleshooting

**"Too many redirects" error:**
- Ensure Cloudflare SSL is set to **Flexible**.
- Ensure Nginx config has `proxy_set_header X-Forwarded-Proto https;`.

**"Verification failed":**
- Check `RECAPTCHA_API_KEY` in `.env`.
- Ensure the API Key has "reCAPTCHA Enterprise API" permission.

---

## 👤 Author

**Divya Mohan**
- GitHub: [@divyamohan1993](https://github.com/divyamohan1993)
- Website: [dmj.one](https://dmj.one)

---
Made with ❤️ for the developer community.
