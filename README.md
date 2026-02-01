# 🚀 On-Demand Project Deployment Orchestrator

A **secure, fully automated** system for deploying project demos on Google Cloud Platform. Deploy temporary spot instances with a single click, protected by reCAPTCHA and password authentication.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Python](https://img.shields.io/badge/python-3.8+-green.svg)
![GCP](https://img.shields.io/badge/GCP-Free%20Tier-orange.svg)

## ✨ Features

- **One-Click Deployment** - Deploy any project with a single click
- **Zero Configuration** - `autoconfig.sh` handles everything automatically
- **Maximum Security** - reCAPTCHA, password auth, encrypted secrets, SSH hardening
- **Cost Effective** - Runs on GCP's always-free e2-micro VM
- **2-Hour Auto-Termination** - Spot instances auto-delete, no runaway costs
- **4GB Swap File** - Overcomes 1GB RAM limitation automatically
- **Beautiful UI** - Modern glassmorphism design with dark theme

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    projects.dmj.one                         │
│                         (HTTPS)                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Always-Free GCP VM (e2-micro)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Nginx     │→ │   Flask     │→ │   GCloud CLI        │ │
│  │   + SSL     │  │   + Auth    │  │   (Create/Delete)   │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Spot Instances                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Project 1  │  │  Project 2  │  │  Project N          │ │
│  │  (2 hours)  │  │  (2 hours)  │  │  (2 hours)          │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## 🔒 Security Features

| Layer | Implementation |
|-------|----------------|
| **Authentication** | reCAPTCHA v2 + Password (SHA-256) |
| **Session** | Flask sessions with 30-min expiry |
| **Rate Limiting** | 100/hour, 20/minute per IP |
| **CSRF Protection** | Flask-WTF tokens |
| **Firewall** | UFW - SSH, HTTP, HTTPS only |
| **Brute Force** | Fail2Ban auto-banning |
| **SSH** | Key-only, no root, 3 max attempts |
| **Encryption** | AES-256 for secrets |
| **SSL/TLS** | Let's Encrypt auto-renewal |

## 🚀 Quick Start

### Prerequisites

- GCP Account with always-free VM (e2-micro in us-east1, us-west1, or us-central1)
- Domain pointing to your VM's IP
- reCAPTCHA v2 keys from [Google reCAPTCHA](https://www.google.com/recaptcha/admin)

### One-Command Deployment

```bash
# SSH into your GCP VM
gcloud compute ssh YOUR_VM_NAME --zone=YOUR_ZONE

# Clone and run
git clone https://github.com/divyamohan1993/on-demand-project-deployment.git /opt/project-orchestrator
cd /opt/project-orchestrator
sudo chmod +x autoconfig.sh
sudo ./autoconfig.sh
```

That's it! The script handles:
- ✅ 4GB Swap file creation
- ✅ All dependencies installation
- ✅ Secure key generation
- ✅ SSL certificate
- ✅ Firewall & security hardening
- ✅ Service auto-start

### Post-Installation

1. **Get your master password:**
   ```bash
   sudo cat /opt/project-orchestrator/secrets/keys/.master_password_INITIAL_DELETE_AFTER_READING
   ```

2. **Add your reCAPTCHA secret key:**
   ```bash
   sudo nano /opt/project-orchestrator/.env
   # Add: RECAPTCHA_SECRET_KEY=your_secret_key
   ```

3. **Restart and access:**
   ```bash
   sudo systemctl restart project-orchestrator
   # Visit: https://your-domain.com
   ```

## 📁 Project Structure

```
on-demand-project-deployment/
├── autoconfig.sh          # 🔧 One-script setup (run this!)
├── requirements.txt       # Python dependencies
├── README.md              # This file
├── server/
│   ├── __init__.py
│   └── app.py             # Flask backend
├── static/
│   ├── css/
│   │   ├── main.css       # Base styles
│   │   └── components.css # UI components
│   └── js/
│       └── app.js         # Frontend logic
└── templates/
    └── index.html         # Main page
```

## ➕ Adding Projects

Edit `server/app.py` and add to the `PROJECTS` dictionary:

```python
PROJECTS = {
    "my-new-project": {
        "name": "My Project Name",
        "description": "What this project does",
        "github_url": "https://github.com/username/repo",
        "autoconfig_script": "autoconfig.sh",  # Must exist in repo
        "port": 3000,
        "env_vars": {
            "PORT": "3000",
            "NODE_ENV": "production",
        },
        "icon": "🚀",
        "category": "Category"
    },
}
```

### Project Requirements

Each deployable project must have an `autoconfig.sh` script that:
1. Installs dependencies
2. Builds the project (if needed)
3. Starts the server

## 💰 Cost Analysis

| Component | Monthly Cost |
|-----------|--------------|
| Orchestrator VM (e2-micro) | **FREE** |
| 30GB Standard Disk | **FREE** |
| 1GB Egress/month | **FREE** |
| Spot Instances | ~$0.002/hour |
| **Typical Monthly Total** | **< $1** |

## 🔧 Management Commands

```bash
# View service status
sudo systemctl status project-orchestrator

# View logs
sudo journalctl -u project-orchestrator -f

# Restart service
sudo systemctl restart project-orchestrator

# Check swap status
free -h
swapon --show

# View firewall status
sudo ufw status

# Renew SSL certificate
sudo certbot renew
```

## 🐛 Troubleshooting

### Service Won't Start
```bash
sudo journalctl -u project-orchestrator -n 50
```

### SSL Certificate Issues
```bash
sudo certbot --nginx -d your-domain.com --force-renewal
```

### Memory Issues
```bash
# Check swap
free -h

# Enable swap manually if needed
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## 📄 License

MIT License - feel free to use and modify.

## 👤 Author

**Divya Mohan**
- GitHub: [@divyamohan1993](https://github.com/divyamohan1993)
- Website: [dmj.one](https://dmj.one)

---

Made with ❤️ for the developer community
