/**
 * On-Demand Project Deployment Orchestrator
 * Frontend JavaScript - reCAPTCHA Enterprise Integration
 */

// Global state
const state = {
    projects: {},
    selectedProject: null,
    activeInstance: null,
    statusPollingInterval: null,
    deploymentsRemaining: 3,
    recaptchaReady: false
};

// reCAPTCHA Enterprise site key (from GCP console)
const RECAPTCHA_SITE_KEY = document.querySelector('meta[name="recaptcha-site-key"]')?.content || '';

// DOM Elements
const elements = {
    projectsGrid: document.getElementById('projectsGrid'),
    deployModal: document.getElementById('deployModal'),
    instanceModal: document.getElementById('instanceModal'),
    deployForm: document.getElementById('deployForm'),
    deployError: document.getElementById('deployError'),
    toastContainer: document.getElementById('toastContainer'),
    deployProjectName: document.getElementById('deployProjectName'),
    rateLimitInfo: document.getElementById('rateLimitInfo'),
    activeInstanceBanner: document.getElementById('activeInstanceBanner')
};

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
});

async function initializeApp() {
    await loadProjects();
    await checkActiveInstance();
    await updateRateLimitDisplay();
    startStatusPolling();
    initRecaptcha();
}

function initRecaptcha() {
    // reCAPTCHA Enterprise is loaded automatically
    if (typeof grecaptcha !== 'undefined' && grecaptcha.enterprise) {
        grecaptcha.enterprise.ready(() => {
            state.recaptchaReady = true;
            console.log('reCAPTCHA Enterprise ready');
        });
    } else {
        // Wait for script to load
        setTimeout(initRecaptcha, 100);
    }
}

// ============================================
// reCAPTCHA ENTERPRISE
// ============================================

async function executeRecaptcha(action) {
    if (!state.recaptchaReady) {
        throw new Error('Security verification not ready. Please wait and try again.');
    }

    try {
        const token = await grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, { action });
        return token;
    } catch (error) {
        console.error('reCAPTCHA execution error:', error);
        throw new Error('Security verification failed. Please refresh and try again.');
    }
}

// ============================================
// API FUNCTIONS
// ============================================

async function loadProjects() {
    try {
        const response = await fetch('/api/projects');
        if (!response.ok) throw new Error('Failed to load projects');

        state.projects = await response.json();
        renderProjects();
    } catch (error) {
        console.error('Error loading projects:', error);
        showToast('Failed to load projects', 'error');
    }
}

async function checkActiveInstance() {
    try {
        const response = await fetch('/api/active-instance');
        const data = await response.json();

        state.activeInstance = data.active_instance;
        updateActiveInstanceBanner();
    } catch (error) {
        console.error('Error checking active instance:', error);
    }
}

async function updateRateLimitDisplay() {
    try {
        const response = await fetch('/api/rate-limit');
        const data = await response.json();

        state.deploymentsRemaining = data.remaining;

        if (elements.rateLimitInfo) {
            if (data.remaining === 0) {
                elements.rateLimitInfo.innerHTML = `
                    <span class="rate-limit-warning">⚠️ Demo limit reached. Resets ${formatTimeUntil(data.reset_time)}</span>
                `;
            } else {
                elements.rateLimitInfo.innerHTML = `
                    <span class="rate-limit-ok">✓ ${data.remaining} demo${data.remaining !== 1 ? 's' : ''} remaining this hour</span>
                `;
            }
        }
    } catch (error) {
        console.error('Error getting rate limit:', error);
    }
}

async function deployProject(projectId, formData) {
    try {
        // Get reCAPTCHA token
        const captchaToken = await executeRecaptcha('DEPLOY');

        const response = await fetch(`/api/deploy/${projectId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({
                ...formData,
                captcha_token: captchaToken
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Deployment failed');
        }

        return data;
    } catch (error) {
        throw error;
    }
}

async function terminateInstance() {
    try {
        const response = await fetch('/api/terminate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({})
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to terminate');
        }

        return data;
    } catch (error) {
        throw error;
    }
}

// ============================================
// RENDERING
// ============================================

function renderProjects() {
    elements.projectsGrid.innerHTML = '';

    for (const [projectId, project] of Object.entries(state.projects)) {
        const card = createProjectCard(projectId, project);
        elements.projectsGrid.appendChild(card);
    }
}

function createProjectCard(projectId, project) {
    const card = document.createElement('div');
    card.className = `project-card ${project.status || 'not_running'}`;
    card.dataset.projectId = projectId;

    const statusLabels = {
        'not_running': 'Available',
        'starting': 'Starting...',
        'running': 'Running',
        'stopping': 'Stopping...',
        'error': 'Error'
    };

    const isActive = project.status === 'running' || project.status === 'starting';

    card.innerHTML = `
        <div class="card-header">
            <span class="card-icon">${project.icon || '📦'}</span>
            <span class="card-status ${project.status || 'not_running'}">
                <span class="dot ${project.status || 'available'}"></span>
                ${statusLabels[project.status] || 'Available'}
            </span>
        </div>
        <h3 class="card-title">${project.name}</h3>
        <span class="card-category">${project.category || 'Project'}</span>
        <p class="card-description">${project.description}</p>
        <div class="card-footer">
            <div class="card-ip">
                ${project.external_ip
            ? `<span class="dot running"></span><code>${project.external_ip}:${project.port}</code>`
            : '<span class="card-ip-placeholder">No active instance</span>'
        }
            </div>
            <div class="card-action">
                ${isActive
            ? '<span>View Demo</span>'
            : '<span>Start Demo</span>'
        }
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
            </div>
        </div>
    `;

    card.addEventListener('click', () => handleCardClick(projectId, project));

    return card;
}

function updateProjectCard(projectId, status) {
    const card = document.querySelector(`[data-project-id="${projectId}"]`);
    if (!card) return;

    state.projects[projectId] = { ...state.projects[projectId], ...status };
    const newCard = createProjectCard(projectId, state.projects[projectId]);
    card.replaceWith(newCard);
}

function updateActiveInstanceBanner() {
    if (!elements.activeInstanceBanner) return;

    if (state.activeInstance) {
        const url = `http://${state.activeInstance.external_ip}:${state.activeInstance.port}`;
        elements.activeInstanceBanner.innerHTML = `
            <div class="active-banner">
                <span class="banner-status">
                    <span class="dot running pulse"></span>
                    <strong>${state.activeInstance.project_name}</strong> is running
                </span>
                <span class="banner-info">
                    <a href="${url}" target="_blank" class="banner-link">${state.activeInstance.external_ip}:${state.activeInstance.port}</a>
                    <span class="banner-expiry">Expires ${formatTimeUntil(state.activeInstance.expires_at)}</span>
                </span>
                <button class="banner-stop" onclick="handleTerminate()">Stop Demo</button>
            </div>
        `;
        elements.activeInstanceBanner.classList.add('visible');
    } else {
        elements.activeInstanceBanner.classList.remove('visible');
    }
}

// ============================================
// MODAL HANDLING
// ============================================

function showDeployModal(projectId, project) {
    state.selectedProject = projectId;
    elements.deployProjectName.textContent = project.name;
    elements.deployModal.classList.add('active');

    // Reset form
    elements.deployForm.reset();
    elements.deployError.classList.remove('show');

    // Show warning if replacing active instance
    const warningEl = document.getElementById('replaceWarning');
    if (warningEl) {
        if (state.activeInstance && state.activeInstance.project_id !== projectId) {
            warningEl.innerHTML = `⚠️ This will stop the currently running <strong>${state.activeInstance.project_name}</strong> demo.`;
            warningEl.classList.add('show');
        } else {
            warningEl.classList.remove('show');
        }
    }
}

function hideDeployModal() {
    elements.deployModal.classList.remove('active');
    state.selectedProject = null;
}

function showInstanceModal(projectId, project) {
    state.selectedProject = projectId;

    document.getElementById('instanceProject').textContent = project.name;
    document.getElementById('instanceIP').textContent = project.external_ip || '-';

    const url = project.external_ip ? `http://${project.external_ip}:${project.port}` : '#';
    document.getElementById('instanceURL').href = url;
    document.getElementById('instanceURL').textContent = url !== '#' ? url : '-';
    document.getElementById('openInstance').href = url;

    document.getElementById('instanceExpiry').textContent = project.expires_at
        ? new Date(project.expires_at).toLocaleString()
        : '-';

    updateCountdown(project.expires_at);

    const statusBadge = document.getElementById('instanceStatusBadge');
    statusBadge.className = `instance-status-badge ${project.status}`;
    statusBadge.querySelector('.status-text').textContent =
        project.status === 'running' ? 'Running' : 'Starting...';

    elements.instanceModal.classList.add('active');
}

function hideInstanceModal() {
    elements.instanceModal.classList.remove('active');
    state.selectedProject = null;
}

function updateCountdown(expiresAt) {
    if (!expiresAt) {
        document.getElementById('instanceTimeRemaining').textContent = '-';
        return;
    }

    const update = () => {
        const now = new Date();
        const expiry = new Date(expiresAt);
        const diff = expiry - now;

        if (diff <= 0) {
            document.getElementById('instanceTimeRemaining').textContent = 'Expired';
            return;
        }

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        document.getElementById('instanceTimeRemaining').textContent =
            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    update();
    setInterval(update, 1000);
}

// ============================================
// EVENT HANDLERS
// ============================================

function setupEventListeners() {
    // Close modals
    document.getElementById('closeDeployModal').addEventListener('click', hideDeployModal);
    document.getElementById('closeInstanceModal').addEventListener('click', hideInstanceModal);

    // Click outside modal to close
    elements.deployModal.addEventListener('click', (e) => {
        if (e.target === elements.deployModal) hideDeployModal();
    });
    elements.instanceModal.addEventListener('click', (e) => {
        if (e.target === elements.instanceModal) hideInstanceModal();
    });

    // Deploy form submission
    elements.deployForm.addEventListener('submit', handleDeploySubmit);

    // Copy IP button
    document.getElementById('copyIP').addEventListener('click', () => {
        const ip = document.getElementById('instanceIP').textContent;
        if (ip && ip !== '-') {
            navigator.clipboard.writeText(ip);
            showToast('IP copied to clipboard', 'success');
        }
    });

    // Stop instance button
    document.getElementById('stopInstance').addEventListener('click', handleStopFromModal);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideDeployModal();
            hideInstanceModal();
        }
    });
}

function handleCardClick(projectId, project) {
    if (project.status === 'running') {
        showInstanceModal(projectId, project);
    } else if (project.status === 'starting') {
        showToast('Demo is still starting, please wait...', 'info');
    } else {
        if (state.deploymentsRemaining <= 0) {
            showToast('Demo limit reached. Please try again later.', 'warning');
            return;
        }
        showDeployModal(projectId, project);
    }
}

async function handleDeploySubmit(e) {
    e.preventDefault();

    const name = document.getElementById('recruiterName').value.trim();
    const email = document.getElementById('recruiterEmail').value.trim();
    const company = document.getElementById('recruiterCompany').value.trim();

    const submitBtn = document.getElementById('deploySubmit');
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-text').style.display = 'none';
    submitBtn.querySelector('.btn-loader').style.display = 'flex';
    elements.deployError.classList.remove('show');

    try {
        const result = await deployProject(state.selectedProject, {
            name,
            email,
            company
        });

        hideDeployModal();
        showToast(`🚀 Starting ${state.projects[state.selectedProject].name}...`, 'success');

        updateProjectCard(state.selectedProject, {
            status: 'starting',
            external_ip: result.external_ip
        });

        await loadProjects();
        await checkActiveInstance();
        await updateRateLimitDisplay();

    } catch (error) {
        elements.deployError.textContent = error.message;
        elements.deployError.classList.add('show');
    } finally {
        submitBtn.disabled = false;
        submitBtn.querySelector('.btn-text').style.display = 'inline';
        submitBtn.querySelector('.btn-loader').style.display = 'none';
    }
}

async function handleTerminate() {
    if (!confirm('Are you sure you want to stop the current demo?')) {
        return;
    }

    showToast('Stopping demo...', 'info');

    try {
        await terminateInstance();
        showToast('Demo stopped successfully', 'success');

        state.activeInstance = null;
        updateActiveInstanceBanner();
        await loadProjects();
    } catch (error) {
        showToast(`Failed to stop: ${error.message}`, 'error');
    }
}

async function handleStopFromModal() {
    if (!state.selectedProject) return;

    const project = state.projects[state.selectedProject];

    if (!confirm(`Are you sure you want to stop the ${project.name} demo?`)) {
        return;
    }

    showToast('Stopping demo...', 'info');

    try {
        await terminateInstance();
        showToast('Demo stopped successfully', 'success');
        hideInstanceModal();

        state.activeInstance = null;
        updateActiveInstanceBanner();
        await loadProjects();
    } catch (error) {
        showToast(`Failed to stop: ${error.message}`, 'error');
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function getCSRFToken() {
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    return metaTag ? metaTag.content : '';
}

function formatTimeUntil(isoString) {
    if (!isoString) return 'soon';

    const target = new Date(isoString);
    const now = new Date();
    const diff = target - now;

    if (diff <= 0) return 'now';

    const minutes = Math.ceil(diff / (1000 * 60));
    if (minutes < 60) return `in ${minutes} minutes`;

    const hours = Math.floor(minutes / 60);
    return `in ${hours} hour${hours !== 1 ? 's' : ''}`;
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✅',
        error: '❌',
        info: 'ℹ️',
        warning: '⚠️'
    };

    toast.innerHTML = `
        <span class="toast-icon">${icons[type]}</span>
        <span class="toast-message">${message}</span>
    `;

    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toast-slide 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function startStatusPolling() {
    state.statusPollingInterval = setInterval(async () => {
        await checkActiveInstance();

        for (const [projectId, project] of Object.entries(state.projects)) {
            if (project.status === 'starting' || project.status === 'running') {
                const response = await fetch('/api/projects');
                if (response.ok) {
                    const updated = await response.json();
                    if (updated[projectId]) {
                        updateProjectCard(projectId, updated[projectId]);
                    }
                }
            }
        }

        updateActiveInstanceBanner();
    }, 10000);
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (state.statusPollingInterval) {
        clearInterval(state.statusPollingInterval);
    }
});
