/**
 * On-Demand Project Deployment Orchestrator
 * Frontend JavaScript - Handles UI interactions and API calls
 */

// Global state
const state = {
    authenticated: false,
    projects: {},
    selectedProject: null,
    statusPollingInterval: null
};

// DOM Elements
const elements = {
    projectsGrid: document.getElementById('projectsGrid'),
    authModal: document.getElementById('authModal'),
    instanceModal: document.getElementById('instanceModal'),
    authForm: document.getElementById('authForm'),
    authError: document.getElementById('authError'),
    authStatus: document.getElementById('authStatus'),
    logoutBtn: document.getElementById('logoutBtn'),
    toastContainer: document.getElementById('toastContainer'),
    deployProjectName: document.getElementById('deployProjectName'),
    passwordInput: document.getElementById('password'),
    togglePassword: document.getElementById('togglePassword')
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
    startStatusPolling();
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

async function authenticate(password, captchaResponse) {
    try {
        const response = await fetch('/api/auth', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            },
            body: JSON.stringify({
                password,
                captcha_response: captchaResponse
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Authentication failed');
        }

        state.authenticated = true;
        updateAuthStatus();
        return data;
    } catch (error) {
        throw error;
    }
}

async function startInstance(projectId) {
    try {
        const response = await fetch(`/api/instance/${projectId}/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to start instance');
        }

        return data;
    } catch (error) {
        throw error;
    }
}

async function stopInstance(projectId) {
    try {
        const response = await fetch(`/api/instance/${projectId}/stop`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken()
            }
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to stop instance');
        }

        return data;
    } catch (error) {
        throw error;
    }
}

async function getInstanceStatus(projectId) {
    try {
        const response = await fetch(`/api/instance/${projectId}/status`);
        return await response.json();
    } catch (error) {
        console.error('Error getting status:', error);
        return { status: 'error' };
    }
}

async function logout() {
    try {
        await fetch('/api/logout', {
            method: 'POST',
            headers: { 'X-CSRFToken': getCSRFToken() }
        });
        state.authenticated = false;
        updateAuthStatus();
        showToast('Logged out successfully', 'success');
    } catch (error) {
        console.error('Logout error:', error);
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
                ${project.status === 'running'
            ? '<span>View Details</span>'
            : '<span>Deploy</span>'
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

    // Update project state
    state.projects[projectId] = { ...state.projects[projectId], ...status };

    // Re-render card
    const newCard = createProjectCard(projectId, state.projects[projectId]);
    card.replaceWith(newCard);
}

// ============================================
// MODAL HANDLING
// ============================================

function showAuthModal(projectId, project) {
    state.selectedProject = projectId;
    elements.deployProjectName.textContent = project.name;
    elements.authModal.classList.add('active');
    elements.passwordInput.focus();

    // Reset form
    elements.authForm.reset();
    elements.authError.classList.remove('show');

    // Reset reCAPTCHA if available
    if (typeof grecaptcha !== 'undefined') {
        grecaptcha.reset();
    }
}

function hideAuthModal() {
    elements.authModal.classList.remove('active');
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
    document.getElementById('closeModal').addEventListener('click', hideAuthModal);
    document.getElementById('closeInstanceModal').addEventListener('click', hideInstanceModal);

    // Click outside modal to close
    elements.authModal.addEventListener('click', (e) => {
        if (e.target === elements.authModal) hideAuthModal();
    });
    elements.instanceModal.addEventListener('click', (e) => {
        if (e.target === elements.instanceModal) hideInstanceModal();
    });

    // Auth form submission
    elements.authForm.addEventListener('submit', handleAuthSubmit);

    // Logout
    elements.logoutBtn.addEventListener('click', logout);

    // Password toggle
    elements.togglePassword.addEventListener('click', () => {
        const type = elements.passwordInput.type === 'password' ? 'text' : 'password';
        elements.passwordInput.type = type;

        const eyeOpen = elements.togglePassword.querySelector('.eye-open');
        const eyeClosed = elements.togglePassword.querySelector('.eye-closed');
        eyeOpen.style.display = type === 'password' ? 'block' : 'none';
        eyeClosed.style.display = type === 'password' ? 'none' : 'block';
    });

    // Copy IP button
    document.getElementById('copyIP').addEventListener('click', () => {
        const ip = document.getElementById('instanceIP').textContent;
        if (ip && ip !== '-') {
            navigator.clipboard.writeText(ip);
            showToast('IP copied to clipboard', 'success');
        }
    });

    // Stop instance button
    document.getElementById('stopInstance').addEventListener('click', handleStopInstance);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideAuthModal();
            hideInstanceModal();
        }
    });
}

function handleCardClick(projectId, project) {
    if (project.status === 'running') {
        showInstanceModal(projectId, project);
    } else if (project.status === 'starting') {
        showToast('Instance is still starting, please wait...', 'info');
    } else {
        if (state.authenticated) {
            deployProject(projectId);
        } else {
            showAuthModal(projectId, project);
        }
    }
}

async function handleAuthSubmit(e) {
    e.preventDefault();

    const password = elements.passwordInput.value;
    const captchaResponse = typeof grecaptcha !== 'undefined'
        ? grecaptcha.getResponse()
        : 'dev-mode';

    if (!captchaResponse) {
        elements.authError.textContent = 'Please complete the CAPTCHA';
        elements.authError.classList.add('show');
        return;
    }

    const submitBtn = document.getElementById('authSubmit');
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-text').style.display = 'none';
    submitBtn.querySelector('.btn-loader').style.display = 'flex';

    try {
        await authenticate(password, captchaResponse);
        hideAuthModal();
        showToast('Authenticated successfully!', 'success');

        // Now deploy the project
        if (state.selectedProject) {
            await deployProject(state.selectedProject);
        }
    } catch (error) {
        elements.authError.textContent = error.message;
        elements.authError.classList.add('show');

        if (typeof grecaptcha !== 'undefined') {
            grecaptcha.reset();
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.querySelector('.btn-text').style.display = 'inline';
        submitBtn.querySelector('.btn-loader').style.display = 'none';
    }
}

async function deployProject(projectId) {
    const project = state.projects[projectId];

    showToast(`Starting deployment for ${project.name}...`, 'info');
    updateProjectCard(projectId, { status: 'starting' });

    try {
        const result = await startInstance(projectId);

        if (result.success) {
            showToast(`Instance started! IP: ${result.external_ip}`, 'success');
            updateProjectCard(projectId, {
                status: 'running',
                external_ip: result.external_ip,
                expires_at: result.expires_at
            });

            // Show instance modal
            showInstanceModal(projectId, {
                ...project,
                status: 'running',
                external_ip: result.external_ip,
                expires_at: result.expires_at
            });
        }
    } catch (error) {
        showToast(`Deployment failed: ${error.message}`, 'error');
        updateProjectCard(projectId, { status: 'not_running' });
    }
}

async function handleStopInstance() {
    if (!state.selectedProject) return;

    const projectId = state.selectedProject;
    const project = state.projects[projectId];

    if (!confirm(`Are you sure you want to stop and delete the instance for ${project.name}?`)) {
        return;
    }

    showToast('Stopping instance...', 'info');

    try {
        await stopInstance(projectId);
        showToast('Instance stopped and deleted', 'success');
        hideInstanceModal();
        updateProjectCard(projectId, {
            status: 'not_running',
            external_ip: null,
            expires_at: null
        });
    } catch (error) {
        showToast(`Failed to stop instance: ${error.message}`, 'error');
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function updateAuthStatus() {
    const statusDot = elements.authStatus.querySelector('.status-dot');

    if (state.authenticated) {
        statusDot.classList.remove('offline');
        statusDot.classList.add('online');
        elements.authStatus.innerHTML = '<span class="status-dot online"></span>Authenticated';
        elements.logoutBtn.style.display = 'flex';
    } else {
        statusDot.classList.remove('online');
        statusDot.classList.add('offline');
        elements.authStatus.innerHTML = '<span class="status-dot offline"></span>Not Authenticated';
        elements.logoutBtn.style.display = 'none';
    }
}

function getCSRFToken() {
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    return metaTag ? metaTag.content : '';
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
        for (const [projectId, project] of Object.entries(state.projects)) {
            if (project.status === 'starting' || project.status === 'running') {
                const status = await getInstanceStatus(projectId);
                if (status.status !== project.status) {
                    updateProjectCard(projectId, status);
                }
            }
        }
    }, 10000); // Poll every 10 seconds
}

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    if (state.statusPollingInterval) {
        clearInterval(state.statusPollingInterval);
    }
});
