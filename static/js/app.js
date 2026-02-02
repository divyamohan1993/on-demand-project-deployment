/**
 * On-Demand Project Deployment Orchestrator
 * Frontend JavaScript - reCAPTCHA Enterprise Integration
 * Version: 2.0.0 - Idempotent & Error-Resilient
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

// reCAPTCHA Enterprise site key
const RECAPTCHA_SITE_KEY = document.querySelector('meta[name="recaptcha-site-key"]')?.content || '';

// DOM Elements - with null safety
const elements = {};

function initializeElements() {
    elements.projectsGrid = document.getElementById('projectsGrid');
    elements.deployModal = document.getElementById('deployModal');
    elements.instanceModal = document.getElementById('instanceModal');
    elements.deployForm = document.getElementById('deployForm');
    elements.deployError = document.getElementById('deployError');
    elements.toastContainer = document.getElementById('toastContainer');
    elements.deployProjectName = document.getElementById('deployProjectName');
    elements.rateLimitInfo = document.getElementById('rateLimitInfo');
    elements.activeInstanceBanner = document.getElementById('activeInstanceBanner');

    // Log missing elements for debugging
    const requiredElements = [
        'projectsGrid', 'deployModal', 'instanceModal', 'deployForm',
        'deployError', 'toastContainer', 'deployProjectName'
    ];

    requiredElements.forEach(id => {
        if (!elements[id]) {
            console.warn(`[App] Missing element: ${id}`);
        }
    });
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('[App] Initializing...');
    initializeElements();
    initializeApp();
    setupEventListeners();
});

async function initializeApp() {
    try {
        await loadProjects();
        await checkActiveInstance();
        await updateRateLimitDisplay();
        startStatusPolling();
        initRecaptcha();
        console.log('[App] Initialization complete');
    } catch (error) {
        console.error('[App] Initialization error:', error);
    }
}

function initRecaptcha() {
    if (typeof grecaptcha !== 'undefined' && grecaptcha.enterprise) {
        grecaptcha.enterprise.ready(() => {
            state.recaptchaReady = true;
            console.log('[reCAPTCHA] Enterprise ready');
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
        console.warn('[reCAPTCHA] Not ready, waiting...');
        // Wait a bit and retry
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!state.recaptchaReady) {
            throw new Error('Security verification not ready. Please wait and try again.');
        }
    }

    try {
        console.log(`[reCAPTCHA] Executing for action: ${action}`);
        const token = await grecaptcha.enterprise.execute(RECAPTCHA_SITE_KEY, { action });
        console.log('[reCAPTCHA] Token obtained successfully');
        return token;
    } catch (error) {
        console.error('[reCAPTCHA] Execution error:', error);
        throw new Error('Security verification failed. Please refresh and try again.');
    }
}

// ============================================
// API FUNCTIONS
// ============================================

async function loadProjects() {
    try {
        console.log('[API] Loading projects...');
        const response = await fetch('/api/projects');
        if (!response.ok) throw new Error('Failed to load projects');

        state.projects = await response.json();
        console.log(`[API] Loaded ${Object.keys(state.projects).length} projects`);
        renderProjects();
    } catch (error) {
        console.error('[API] Error loading projects:', error);
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
        console.error('[API] Error checking active instance:', error);
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
        console.error('[API] Error getting rate limit:', error);
    }
}

async function deployProject(projectId, formData) {
    try {
        console.log(`[Deploy] Starting deployment for: ${projectId}`);

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
            console.error(`[Deploy] Failed: ${data.error}`);
            throw new Error(data.error || 'Deployment failed');
        }

        console.log('[Deploy] Success:', data);
        return data;
    } catch (error) {
        console.error('[Deploy] Error:', error);
        throw error;
    }
}

async function terminateInstance() {
    try {
        console.log('[Terminate] Stopping instance...');
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

        console.log('[Terminate] Success');
        return data;
    } catch (error) {
        console.error('[Terminate] Error:', error);
        throw error;
    }
}

// ============================================
// RENDERING
// ============================================

function renderProjects() {
    if (!elements.projectsGrid) {
        console.error('[Render] projectsGrid element not found');
        return;
    }

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
    if (!elements.deployModal) {
        console.error('[Modal] deployModal not found');
        return;
    }

    state.selectedProject = projectId;

    if (elements.deployProjectName) {
        elements.deployProjectName.textContent = project.name;
    }

    elements.deployModal.classList.add('active');

    // Reset form
    if (elements.deployForm) {
        elements.deployForm.reset();
    }
    if (elements.deployError) {
        elements.deployError.classList.remove('show');
    }

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
    if (elements.deployModal) {
        elements.deployModal.classList.remove('active');
    }
    state.selectedProject = null;
}

function showInstanceModal(projectId, project) {
    if (!elements.instanceModal) {
        console.error('[Modal] instanceModal not found');
        return;
    }

    state.selectedProject = projectId;

    const instanceProject = document.getElementById('instanceProject');
    const instanceIP = document.getElementById('instanceIP');
    const instanceURL = document.getElementById('instanceURL');
    const openInstance = document.getElementById('openInstance');
    const instanceExpiry = document.getElementById('instanceExpiry');
    const statusBadge = document.getElementById('instanceStatusBadge');

    if (instanceProject) instanceProject.textContent = project.name;
    if (instanceIP) instanceIP.textContent = project.external_ip || '-';

    const url = project.external_ip ? `http://${project.external_ip}:${project.port}` : '#';
    if (instanceURL) {
        instanceURL.href = url;
        instanceURL.textContent = url !== '#' ? url : '-';
    }
    if (openInstance) openInstance.href = url;

    if (instanceExpiry) {
        instanceExpiry.textContent = project.expires_at
            ? new Date(project.expires_at).toLocaleString()
            : '-';
    }

    updateCountdown(project.expires_at);

    if (statusBadge) {
        statusBadge.className = `instance-status-badge ${project.status}`;
        const statusText = statusBadge.querySelector('.status-text');
        if (statusText) {
            statusText.textContent = project.status === 'running' ? 'Running' : 'Starting...';
        }
    }

    elements.instanceModal.classList.add('active');
}

function hideInstanceModal() {
    if (elements.instanceModal) {
        elements.instanceModal.classList.remove('active');
    }
    state.selectedProject = null;
}

function updateCountdown(expiresAt) {
    const timeRemainingEl = document.getElementById('instanceTimeRemaining');
    if (!timeRemainingEl) return;

    if (!expiresAt) {
        timeRemainingEl.textContent = '-';
        return;
    }

    const update = () => {
        const now = new Date();
        const expiry = new Date(expiresAt);
        const diff = expiry - now;

        if (diff <= 0) {
            timeRemainingEl.textContent = 'Expired';
            return;
        }

        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        timeRemainingEl.textContent =
            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    update();
    setInterval(update, 1000);
}

// ============================================
// EVENT HANDLERS
// ============================================

function setupEventListeners() {
    console.log('[Events] Setting up event listeners...');

    // Close modals - with null checks
    const closeDeployModal = document.getElementById('closeDeployModal');
    const closeInstanceModal = document.getElementById('closeInstanceModal');

    if (closeDeployModal) {
        closeDeployModal.addEventListener('click', hideDeployModal);
    } else {
        console.warn('[Events] closeDeployModal not found');
    }

    if (closeInstanceModal) {
        closeInstanceModal.addEventListener('click', hideInstanceModal);
    } else {
        console.warn('[Events] closeInstanceModal not found');
    }

    // Click outside modal to close
    if (elements.deployModal) {
        elements.deployModal.addEventListener('click', (e) => {
            if (e.target === elements.deployModal) hideDeployModal();
        });
    }
    if (elements.instanceModal) {
        elements.instanceModal.addEventListener('click', (e) => {
            if (e.target === elements.instanceModal) hideInstanceModal();
        });
    }

    // Deploy form submission
    if (elements.deployForm) {
        elements.deployForm.addEventListener('submit', handleDeploySubmit);
    } else {
        console.warn('[Events] deployForm not found');
    }

    // Copy IP button
    const copyIP = document.getElementById('copyIP');
    if (copyIP) {
        copyIP.addEventListener('click', () => {
            const ip = document.getElementById('instanceIP')?.textContent;
            if (ip && ip !== '-') {
                navigator.clipboard.writeText(ip);
                showToast('IP copied to clipboard', 'success');
            }
        });
    }

    // Stop instance button
    const stopInstance = document.getElementById('stopInstance');
    if (stopInstance) {
        stopInstance.addEventListener('click', handleStopFromModal);
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideDeployModal();
            hideInstanceModal();
        }
    });

    console.log('[Events] Event listeners ready');
}

function handleCardClick(projectId, project) {
    console.log(`[Card] Clicked: ${projectId}, status: ${project.status}`);

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
    console.log('[Deploy] Form submitted');

    const nameInput = document.getElementById('recruiterName');
    const emailInput = document.getElementById('recruiterEmail');
    const companyInput = document.getElementById('recruiterCompany');

    const name = nameInput?.value.trim() || '';
    const email = emailInput?.value.trim() || '';
    const company = companyInput?.value.trim() || '';

    const submitBtn = document.getElementById('deploySubmit');
    if (!submitBtn) {
        console.error('[Deploy] Submit button not found');
        return;
    }

    submitBtn.disabled = true;
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoader = submitBtn.querySelector('.btn-loader');

    if (btnText) btnText.style.display = 'none';
    if (btnLoader) btnLoader.style.display = 'flex';
    if (elements.deployError) elements.deployError.classList.remove('show');

    try {
        const projectId = state.selectedProject;
        const projectName = state.projects[projectId]?.name || 'Project';

        const result = await deployProject(projectId, {
            name,
            email,
            company
        });

        hideDeployModal();
        showToast(`🚀 Starting ${projectName}...`, 'success');

        updateProjectCard(projectId, {
            status: 'starting',
            external_ip: result.external_ip
        });

        await loadProjects();
        await checkActiveInstance();
        await updateRateLimitDisplay();

    } catch (error) {
        console.error('[Deploy] Submit error:', error);
        if (elements.deployError) {
            elements.deployError.textContent = error.message;
            elements.deployError.classList.add('show');
        }
    } finally {
        submitBtn.disabled = false;
        if (btnText) btnText.style.display = 'inline';
        if (btnLoader) btnLoader.style.display = 'none';
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
    if (!elements.toastContainer) {
        console.warn('[Toast] Container not found, logging instead:', message);
        return;
    }

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
                try {
                    const response = await fetch('/api/projects');
                    if (response.ok) {
                        const updated = await response.json();
                        if (updated[projectId]) {
                            updateProjectCard(projectId, updated[projectId]);
                        }
                    }
                } catch (error) {
                    console.warn('[Polling] Error:', error);
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

console.log('[App] Script loaded');
