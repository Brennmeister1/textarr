// Textarr - Configuration UI

const API_BASE = '';

// Simple hash function for cache key generation
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

// State
let currentConfig = null;
let users = [];
let isSaving = false;
let isDirty = false;
let initialFormState = null;
let csrfToken = null;

// Auth state
let authState = {
  isSetup: false,
  isAuthenticated: false,
  username: null
};

// ============================================================================
// CSRF Token Handling
// ============================================================================

async function fetchCsrfToken() {
  try {
    const response = await fetch(`${API_BASE}/api/auth/csrf`, { credentials: 'include' });
    const data = await response.json();
    csrfToken = data.csrfToken;
    return csrfToken;
  } catch (error) {
    console.warn('Failed to fetch CSRF token:', error);
    return null;
  }
}

async function getCsrfToken() {
  if (!csrfToken) {
    await fetchCsrfToken();
  }
  return csrfToken;
}

// Helper for making POST/PUT/DELETE requests with CSRF token
async function apiPost(endpoint, body) {
  const token = await getCsrfToken();
  return fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token || '',
    },
    body: JSON.stringify(body),
  });
}

async function apiPut(endpoint, body) {
  const token = await getCsrfToken();
  return fetch(endpoint, {
    method: 'PUT',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token || '',
    },
    body: JSON.stringify(body),
  });
}

async function apiDelete(endpoint) {
  const token = await getCsrfToken();
  return fetch(endpoint, {
    method: 'DELETE',
    credentials: 'include',
    headers: {
      'X-CSRF-Token': token || '',
    },
  });
}

async function apiGet(url) {
  return fetch(url, {
    credentials: 'include'
  });
}

// ============================================================================
// Authentication Functions
// ============================================================================

/**
 * Check authentication status and show appropriate view
 */
async function checkAuthStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/auth/status`, {
      credentials: 'include'
    });
    const data = await response.json();

    authState = {
      isSetup: data.isSetup,
      isAuthenticated: data.isAuthenticated,
      username: data.username
    };

    updateViewForAuthState();
  } catch (error) {
    console.error('Failed to check auth status:', error);
    showToast('Failed to connect to server', 'error');
  }
}

/**
 * Show the appropriate view based on auth state
 */
function updateViewForAuthState() {
  const setupView = document.getElementById('authSetupView');
  const loginView = document.getElementById('authLoginView');
  const dashboardView = document.getElementById('dashboardView');

  // Hide all views first
  setupView.style.display = 'none';
  loginView.style.display = 'none';
  dashboardView.style.display = 'none';

  if (!authState.isSetup) {
    // First-time setup
    setupView.style.display = 'flex';
    document.getElementById('setupUsername')?.focus();
  } else if (!authState.isAuthenticated) {
    // Need to login
    loginView.style.display = 'flex';
    document.getElementById('loginUsername')?.focus();
  } else {
    // Authenticated - show dashboard
    dashboardView.style.display = 'block';
    updateUserDisplay();
  }
}

/**
 * Update the username display in header
 */
function updateUserDisplay() {
  const usernameEl = document.getElementById('currentUsername');
  if (usernameEl && authState.username) {
    usernameEl.textContent = authState.username;
  }
}

/**
 * Show error in auth error element
 */
function showAuthError(errorEl, message) {
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

/**
 * Handle setup form submission
 */
async function handleSetup(event) {
  event.preventDefault();

  const username = document.getElementById('setupUsername').value.trim();
  const password = document.getElementById('setupPassword').value;
  const confirmPassword = document.getElementById('setupConfirmPassword').value;
  const errorEl = document.getElementById('setupError');
  const submitBtn = document.getElementById('setupBtn');

  // Clear previous error
  errorEl.style.display = 'none';

  // Client-side validation
  if (username.length < 3) {
    showAuthError(errorEl, 'Username must be at least 3 characters');
    return;
  }

  if (password.length < 8) {
    showAuthError(errorEl, 'Password must be at least 8 characters');
    return;
  }

  if (password !== confirmPassword) {
    showAuthError(errorEl, 'Passwords do not match');
    return;
  }

  // Show loading state
  submitBtn.disabled = true;
  submitBtn.classList.add('loading');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '';

  try {
    const response = await apiPost(`${API_BASE}/api/auth/setup`, {
      username,
      password,
      confirmPassword
    });

    const data = await response.json();

    if (response.ok && data.success) {
      showToast('Account created successfully!', 'success');
      // Update state and show dashboard (auto-logged in after setup)
      authState.isSetup = true;
      authState.isAuthenticated = true;
      authState.username = username;
      updateViewForAuthState();
      // Load dashboard data
      loadConfig();
      loadUsers();
      updateWebhookUrl();
      setupDirtyTracking();
      setupUnsavedWarning();
    } else {
      showAuthError(errorEl, data.error || 'Setup failed');
    }
  } catch (error) {
    console.error('Setup error:', error);
    showAuthError(errorEl, 'Failed to create account. Please try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove('loading');
    submitBtn.textContent = originalText;
  }
}

/**
 * Handle login form submission
 */
async function handleLogin(event) {
  event.preventDefault();

  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginBtn');

  // Clear previous error
  errorEl.style.display = 'none';

  if (!username || !password) {
    showAuthError(errorEl, 'Please enter username and password');
    return;
  }

  // Show loading state
  submitBtn.disabled = true;
  submitBtn.classList.add('loading');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '';

  try {
    const response = await apiPost(`${API_BASE}/api/auth/login`, {
      username,
      password
    });

    const data = await response.json();

    if (response.ok && data.success) {
      showToast('Logged in successfully!', 'success');
      authState.isAuthenticated = true;
      authState.username = username;
      updateViewForAuthState();
      // Load dashboard data
      loadConfig();
      loadUsers();
      updateWebhookUrl();
      setupDirtyTracking();
      setupUnsavedWarning();
    } else {
      showAuthError(errorEl, data.error || 'Invalid credentials');
    }
  } catch (error) {
    console.error('Login error:', error);
    showAuthError(errorEl, 'Login failed. Please try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove('loading');
    submitBtn.textContent = originalText;
  }
}

/**
 * Handle logout
 */
async function handleLogout() {
  try {
    await apiPost(`${API_BASE}/api/auth/logout`, {});
    authState.isAuthenticated = false;
    authState.username = null;
    updateViewForAuthState();
    showToast('Logged out successfully', 'success');
    closeUserDropdown();
  } catch (error) {
    console.error('Logout error:', error);
    showToast('Logout failed', 'error');
  }
}

/**
 * Handle change password form submission
 */
async function handleChangePassword(event) {
  event.preventDefault();

  const currentPassword = document.getElementById('currentPassword').value;
  const newPassword = document.getElementById('newPassword').value;
  const confirmNewPassword = document.getElementById('confirmNewPassword').value;
  const errorEl = document.getElementById('changePasswordError');

  // Clear previous error
  errorEl.style.display = 'none';

  if (newPassword.length < 8) {
    showAuthError(errorEl, 'New password must be at least 8 characters');
    return;
  }

  if (newPassword !== confirmNewPassword) {
    showAuthError(errorEl, 'New passwords do not match');
    return;
  }

  try {
    const response = await apiPost(`${API_BASE}/api/auth/change-password`, {
      currentPassword,
      newPassword
    });

    const data = await response.json();

    if (response.ok && data.success) {
      showToast('Password changed successfully', 'success');
      closeChangePasswordModal();
      document.getElementById('changePasswordForm').reset();
    } else {
      showAuthError(errorEl, data.error || 'Failed to change password');
    }
  } catch (error) {
    console.error('Change password error:', error);
    showAuthError(errorEl, 'Failed to change password. Please try again.');
  }
}

/**
 * Toggle user dropdown menu
 */
function toggleUserDropdown() {
  const menu = document.getElementById('userMenu');
  const dropdown = document.getElementById('userDropdown');
  const isOpen = dropdown.style.display !== 'none';

  if (isOpen) {
    closeUserDropdown();
  } else {
    dropdown.style.display = 'block';
    menu.classList.add('open');
    // Close on outside click
    setTimeout(() => document.addEventListener('click', handleOutsideDropdownClick), 0);
  }
}

function closeUserDropdown() {
  const menu = document.getElementById('userMenu');
  const dropdown = document.getElementById('userDropdown');
  if (dropdown) dropdown.style.display = 'none';
  if (menu) menu.classList.remove('open');
  document.removeEventListener('click', handleOutsideDropdownClick);
}

function handleOutsideDropdownClick(event) {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.contains(event.target)) {
    closeUserDropdown();
  }
}

/**
 * Open change password modal
 */
function openChangePasswordModal() {
  document.getElementById('changePasswordModal').style.display = 'flex';
  document.getElementById('currentPassword').focus();
  closeUserDropdown();
}

/**
 * Close change password modal
 */
function closeChangePasswordModal() {
  document.getElementById('changePasswordModal').style.display = 'none';
  document.getElementById('changePasswordForm').reset();
  document.getElementById('changePasswordError').style.display = 'none';
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Populate a select dropdown while preserving current selection
 * @param {string} selectId - The select element ID
 * @param {Array} items - Array of items with id/name, value/label, or path properties
 * @param {Object} options - Optional settings
 * @param {string} options.defaultOption - Text for default empty option
 * @param {string} options.valueKey - Key for option value
 * @param {string} options.labelKey - Key for option label
 */
function populateSelect(selectId, items, options = {}) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const currentValue = select.value;
  const { defaultOption, valueKey, labelKey } = options;

  select.innerHTML = defaultOption ? `<option value="">${defaultOption}</option>` : '';

  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item[valueKey] ?? item.id ?? item.value ?? item.path;
    option.textContent = item[labelKey] ?? item.name ?? item.label ?? item.path;
    select.appendChild(option);
  });

  // Restore previous selection if still valid
  if (currentValue && Array.from(select.options).find((o) => o.value == currentValue)) {
    select.value = currentValue;
  }
}

/**
 * Generic service test function
 * @param {string} endpoint - API endpoint (e.g., 'test-tmdb')
 * @param {Object} payload - Data to send
 * @param {string} errorMessage - Message on network failure
 */
async function testService(endpoint, payload, errorMessage) {
  try {
    const response = await apiPost(`${API_BASE}/api/config/${endpoint}`, payload);
    const data = await response.json();
    showToast(data.message, data.success ? 'success' : 'error');
  } catch (error) {
    showToast(errorMessage, 'error');
  }
}

// ============================================================================

// Get current form state as JSON string for comparison
function getCurrentFormState() {
  return JSON.stringify(gatherFormData());
}

// Capture initial form state after loading
function captureInitialState() {
  initialFormState = getCurrentFormState();
  isDirty = false;
  updateDirtyIndicator();
}

// Check if form has unsaved changes
function checkDirtyState() {
  if (!initialFormState) return;
  const currentState = getCurrentFormState();
  isDirty = currentState !== initialFormState;
  updateDirtyIndicator();
}

// Update visual indicator for dirty state
function updateDirtyIndicator() {
  const saveBtn = document.querySelector('.save-btn');
  if (saveBtn) {
    saveBtn.classList.toggle('dirty', isDirty);
  }
}

// Clear all validation errors
function clearValidationErrors() {
  document.querySelectorAll('.form-group.has-error').forEach((group) => {
    group.classList.remove('has-error');
  });
  document.querySelectorAll('.field-error').forEach((el) => el.remove());
}

// Display validation errors from backend
function displayValidationErrors(errors) {
  clearValidationErrors();

  if (!errors || !Array.isArray(errors)) return;

  errors.forEach((err) => {
    // Zod errors have path like ['ai', 'model'] - convert to input ID
    const path = err.path || [];
    const fieldId = pathToFieldId(path);
    const input = document.getElementById(fieldId);

    if (input) {
      const formGroup = input.closest('.form-group');
      if (formGroup) {
        formGroup.classList.add('has-error');
        const errorEl = document.createElement('p');
        errorEl.className = 'field-error';
        errorEl.textContent = err.message;
        formGroup.appendChild(errorEl);
      }
    }
  });
}

// Convert Zod error path to input field ID
function pathToFieldId(path) {
  // Map config paths to form field IDs
  const mapping = {
    'ai.provider': 'aiProvider',
    'ai.model': 'aiModel',
    'ai.openaiApiKey': 'openaiApiKey',
    'ai.anthropicApiKey': 'anthropicApiKey',
    'ai.googleApiKey': 'googleApiKey',
    'twilio.accountSid': 'twilioAccountSid',
    'twilio.authToken': 'twilioAuthToken',
    'twilio.phoneNumber': 'twilioPhoneNumber',
    'sonarr.url': 'sonarrUrl',
    'sonarr.apiKey': 'sonarrApiKey',
    'sonarr.qualityProfileId': 'sonarrQualityProfile',
    'sonarr.rootFolder': 'sonarrRootFolder',
    'radarr.url': 'radarrUrl',
    'radarr.apiKey': 'radarrApiKey',
    'radarr.qualityProfileId': 'radarrQualityProfile',
    'radarr.rootFolder': 'radarrRootFolder',
    'prowlarr.url': 'prowlarrUrl',
    'prowlarr.apiKey': 'prowlarrApiKey',
    'tmdb.apiKey': 'tmdbApiKey',
    'tmdb.language': 'tmdbLanguage',
    'session.timeoutMs': 'sessionTimeout',
    'session.maxSearchResults': 'maxSearchResults',
    'server.port': 'serverPort',
    'server.logLevel': 'logLevel',
    'quotas.enabled': 'quotasEnabled',
    'quotas.period': 'quotasPeriod',
    'quotas.movieLimit': 'quotasMovieLimit',
    'quotas.tvShowLimit': 'quotasTvShowLimit',
    'quotas.adminExempt': 'quotasAdminExempt',
  };

  const key = path.join('.');
  return mapping[key] || path[path.length - 1] || '';
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Fetch CSRF token first for POST/PUT/DELETE requests
  await fetchCsrfToken();
  setupEventListeners();

  // Check auth status first - this determines which view to show
  await checkAuthStatus();

  // Only load config/users if authenticated
  if (authState.isAuthenticated) {
    loadConfig();
    loadUsers();
    updateWebhookUrl();
    setupDirtyTracking();
    setupUnsavedWarning();
  }
});

// Set up all event listeners (replaces inline handlers for CSP compliance)
function setupEventListeners() {
  // Authentication event listeners
  document.getElementById('setupForm')?.addEventListener('submit', handleSetup);
  document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
  document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);
  document.getElementById('userMenuBtn')?.addEventListener('click', toggleUserDropdown);
  document.getElementById('changePasswordBtn')?.addEventListener('click', openChangePasswordModal);
  document.getElementById('changePasswordForm')?.addEventListener('submit', handleChangePassword);
  document.getElementById('closePasswordModal')?.addEventListener('click', closeChangePasswordModal);
  document.getElementById('cancelPasswordChange')?.addEventListener('click', closeChangePasswordModal);

  // Close modal on overlay click
  document.getElementById('changePasswordModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'changePasswordModal') {
      closeChangePasswordModal();
    }
  });

  // Alert close button
  document.getElementById('alertCloseBtn')?.addEventListener('click', hideAlert);

  // AI Configuration
  document.getElementById('testAIBtn')?.addEventListener('click', testAI);
  document.getElementById('aiProvider')?.addEventListener('change', () => updateModelOptions());
  document.getElementById('aiModel')?.addEventListener('change', handleModelChange);
  document.getElementById('refreshModelsBtn')?.addEventListener('click', refreshModels);
  document.getElementById('aiTemperature')?.addEventListener('input', (e) => {
    document.getElementById('aiTemperatureValue').textContent = e.target.value;
  });
  document.getElementById('resetSystemPromptBtn')?.addEventListener('click', resetSystemPrompt);
  document.getElementById('resetMessagesBtn')?.addEventListener('click', resetMessages);

  // Twilio
  document.getElementById('testTwilioBtn')?.addEventListener('click', testTwilio);

  // Sonarr
  document.querySelector('[data-test-connection="sonarr"]')?.addEventListener('click', () => testConnection('sonarr'));
  document.getElementById('fetchSonarrBtn')?.addEventListener('click', fetchSonarrOptions);

  // Radarr
  document.querySelector('[data-test-connection="radarr"]')?.addEventListener('click', () => testConnection('radarr'));
  document.getElementById('fetchRadarrBtn')?.addEventListener('click', fetchRadarrOptions);

  // Prowlarr
  document.querySelector('[data-test-connection="prowlarr"]')?.addEventListener('click', () => testConnection('prowlarr'));

  // TMDB
  document.getElementById('testTMDBBtn')?.addEventListener('click', testTMDB);

  // Users
  document.getElementById('addUserBtn')?.addEventListener('click', showAddUserForm);

  // Save button
  document.getElementById('saveConfigBtn')?.addEventListener('click', saveConfig);

  // Webhook setup buttons
  document.getElementById('setupSonarrWebhookBtn')?.addEventListener('click', () => setupArrWebhook('sonarr'));
  document.getElementById('setupRadarrWebhookBtn')?.addEventListener('click', () => setupArrWebhook('radarr'));
  document.getElementById('copyWebhookSecretBtn')?.addEventListener('click', copyWebhookSecret);

  // Update webhook URLs when external URL changes
  document.getElementById('serverExternalUrl')?.addEventListener('input', updateArrWebhookUrls);

  // Collapsible sections (event delegation)
  document.querySelectorAll('.collapsible-header').forEach((button) => {
    button.addEventListener('click', () => toggleCollapsible(button));
  });

  // User table actions (event delegation on the table body)
  document.getElementById('usersTableBody')?.addEventListener('click', handleUserTableAction);
}

// Set up event listeners for dirty tracking
function setupDirtyTracking() {
  // Track changes on all form inputs
  const formInputs = document.querySelectorAll('input, select, textarea');
  formInputs.forEach((input) => {
    input.addEventListener('input', checkDirtyState);
    input.addEventListener('change', checkDirtyState);
  });
}

// Set up beforeunload warning for unsaved changes
function setupUnsavedWarning() {
  window.addEventListener('beforeunload', (e) => {
    if (isDirty) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
}

// Update webhook URL display
function updateWebhookUrl() {
  const url = `${window.location.origin}/webhooks/sms`;
  document.getElementById('webhookUrl').textContent = url;
  const setupUrl = document.getElementById('webhookUrlSetup');
  if (setupUrl) setupUrl.textContent = url;
}

// Update Sonarr/Radarr webhook URLs based on external URL
function updateArrWebhookUrls() {
  const externalUrl = document.getElementById('serverExternalUrl')?.value.trim() || window.location.origin;
  const baseUrl = externalUrl.replace(/\/$/, '');

  const sonarrUrl = document.getElementById('sonarrWebhookUrl');
  const radarrUrl = document.getElementById('radarrWebhookUrl');

  if (sonarrUrl) sonarrUrl.textContent = `${baseUrl}/webhooks/sonarr`;
  if (radarrUrl) radarrUrl.textContent = `${baseUrl}/webhooks/radarr`;
}

// Fetch webhook secret from server (generates if not set)
async function fetchWebhookSecret() {
  const webhookSecretDisplay = document.getElementById('webhookSecretDisplay');
  if (!webhookSecretDisplay) return;

  try {
    const response = await apiGet(`${API_BASE}/api/config/webhook-secret`);
    const data = await response.json();

    if (data.webhookSecret) {
      webhookSecretDisplay.textContent = data.webhookSecret;
      webhookSecretDisplay.style.fontStyle = 'normal';
    } else {
      webhookSecretDisplay.textContent = 'Error loading secret';
      webhookSecretDisplay.style.fontStyle = 'italic';
    }
  } catch (error) {
    console.error('Failed to fetch webhook secret:', error);
    webhookSecretDisplay.textContent = 'Error loading secret';
    webhookSecretDisplay.style.fontStyle = 'italic';
  }
}

// Copy webhook secret to clipboard
function copyWebhookSecret() {
  const secretEl = document.getElementById('webhookSecretDisplay');
  const secret = secretEl?.textContent;

  if (!secret || secret.includes('Not set') || secret.includes('Error') || secret === 'Loading...') {
    showToast('No webhook secret to copy', 'error');
    return;
  }

  navigator.clipboard.writeText(secret).then(() => {
    showToast('Webhook secret copied to clipboard', 'success');
  }).catch(() => {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = secret;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    showToast('Webhook secret copied to clipboard', 'success');
  });
}

// Setup webhook in Sonarr/Radarr
async function setupArrWebhook(type) {
  const url = document.getElementById(`${type}Url`)?.value;
  const apiKey = document.getElementById(`${type}ApiKey`)?.value;
  const externalUrl = document.getElementById('serverExternalUrl')?.value.trim();

  if (!url || !apiKey) {
    showToast(`Please enter ${type} URL and API key first`, 'error');
    return;
  }

  if (!externalUrl) {
    showToast('Please configure External URL in Server settings first', 'error');
    return;
  }

  const statusEl = document.getElementById('webhookSetupStatus');
  const btn = document.getElementById(`setup${type.charAt(0).toUpperCase() + type.slice(1)}WebhookBtn`);

  // Show loading state
  if (btn) {
    btn.disabled = true;
    btn.classList.add('loading');
  }
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.className = 'webhook-status loading';
    statusEl.textContent = `Setting up ${type} webhook...`;
  }

  try {
    const response = await apiPost(`${API_BASE}/api/config/setup-webhook/${type}`, { url, apiKey });
    const data = await response.json();

    if (response.ok && data.success) {
      showToast(data.message || `${type} webhook configured successfully`, 'success');
      if (statusEl) {
        statusEl.className = 'webhook-status success';
        statusEl.textContent = data.message || `${type} webhook configured!`;
      }
    } else {
      showToast(data.error || `Failed to setup ${type} webhook`, 'error');
      if (statusEl) {
        statusEl.className = 'webhook-status error';
        statusEl.textContent = data.error || `Failed to setup ${type} webhook`;
      }
    }
  } catch (error) {
    console.error(`Failed to setup ${type} webhook:`, error);
    showToast(`Failed to setup ${type} webhook`, 'error');
    if (statusEl) {
      statusEl.className = 'webhook-status error';
      statusEl.textContent = `Connection error: ${error.message}`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('loading');
    }
  }
}

// Load configuration from server
async function loadConfig() {
  try {
    const response = await apiGet(`${API_BASE}/api/config/raw`);
    const data = await response.json();
    currentConfig = data.config;
    populateForm(currentConfig);
    await updateStatus();
    // Capture initial state after form is fully populated
    setTimeout(captureInitialState, 100);
  } catch (error) {
    console.error('Failed to load config:', error);
    showToast('Failed to load configuration', 'error');
  }
}

// Populate form with config values
function populateForm(config) {
  // AI
  document.getElementById('aiProvider').value = config.ai?.provider || 'openai';
  document.getElementById('aiModel').value = config.ai?.model || 'gpt-4-turbo';
  document.getElementById('openaiApiKey').value = config.ai?.openaiApiKey || '';
  document.getElementById('anthropicApiKey').value = config.ai?.anthropicApiKey || '';
  document.getElementById('googleApiKey').value = config.ai?.googleApiKey || '';
  // AI customization
  document.getElementById('aiTemperature').value = config.ai?.temperature ?? 0.2;
  document.getElementById('aiTemperatureValue').textContent = config.ai?.temperature ?? 0.2;
  document.getElementById('aiResponseStyle').value = config.ai?.responseStyle || 'standard';
  // Load system prompt - use saved value or fetch default
  loadSystemPrompt(config.ai?.systemPrompt);
  updateModelOptions();

  // Twilio
  document.getElementById('twilioEnabled').checked = config.twilio?.enabled !== false;
  document.getElementById('twilioAccountSid').value = config.twilio?.accountSid || '';
  document.getElementById('twilioAuthToken').value = config.twilio?.authToken || '';
  document.getElementById('twilioPhoneNumber').value = config.twilio?.phoneNumber || '';
  document.getElementById('twilioSendPosterImages').checked =
    config.twilio?.sendPosterImages || false;

  // Telegram
  document.getElementById('telegramEnabled').checked = config.telegram?.enabled || false;
  document.getElementById('telegramBotToken').value = config.telegram?.botToken || '';
  document.getElementById('telegramAllowedChatIds').value = (config.telegram?.allowedChatIds || []).join(', ');
  document.getElementById('telegramUsePolling').checked = config.telegram?.usePolling !== false;
  document.getElementById('telegramRespondUnregistered').checked = config.telegram?.respondToUnregistered !== false;

  // Discord
  document.getElementById('discordEnabled').checked = config.discord?.enabled || false;
  document.getElementById('discordBotToken').value = config.discord?.botToken || '';
  document.getElementById('discordAllowedGuildIds').value = (config.discord?.allowedGuildIds || []).join(', ');
  document.getElementById('discordAllowedChannelIds').value = (config.discord?.allowedChannelIds || []).join(', ');
  document.getElementById('discordRespondUnregistered').checked = config.discord?.respondToUnregistered !== false;

  // Slack
  document.getElementById('slackEnabled').checked = config.slack?.enabled || false;
  document.getElementById('slackBotToken').value = config.slack?.botToken || '';
  document.getElementById('slackSigningSecret').value = config.slack?.signingSecret || '';
  document.getElementById('slackUseSocketMode').checked = config.slack?.useSocketMode || false;
  document.getElementById('slackAppToken').value = config.slack?.appToken || '';
  document.getElementById('slackRespondUnregistered').checked = config.slack?.respondToUnregistered !== false;

  // Sonarr
  document.getElementById('sonarrUrl').value = config.sonarr?.url || 'http://localhost:8989';
  document.getElementById('sonarrApiKey').value = config.sonarr?.apiKey || '';
  setSelectValue('sonarrQualityProfile', config.sonarr?.qualityProfileId || 1);
  setSelectValue('sonarrRootFolder', config.sonarr?.rootFolder || '/tv');
  // Sonarr anime settings
  if (config.sonarr?.animeQualityProfileId) {
    setSelectValue('sonarrAnimeQualityProfile', config.sonarr.animeQualityProfileId);
  }
  if (config.sonarr?.animeRootFolder) {
    setSelectValue('sonarrAnimeRootFolder', config.sonarr.animeRootFolder);
  }

  // Radarr
  document.getElementById('radarrUrl').value = config.radarr?.url || 'http://localhost:7878';
  document.getElementById('radarrApiKey').value = config.radarr?.apiKey || '';
  setSelectValue('radarrQualityProfile', config.radarr?.qualityProfileId || 1);
  setSelectValue('radarrRootFolder', config.radarr?.rootFolder || '/movies');
  // Radarr anime settings
  if (config.radarr?.animeQualityProfileId) {
    setSelectValue('radarrAnimeQualityProfile', config.radarr.animeQualityProfileId);
  }
  if (config.radarr?.animeRootFolder) {
    setSelectValue('radarrAnimeRootFolder', config.radarr.animeRootFolder);
  }

  // Prowlarr
  document.getElementById('prowlarrUrl').value = config.prowlarr?.url || 'http://localhost:9696';
  document.getElementById('prowlarrApiKey').value = config.prowlarr?.apiKey || '';

  // TMDB
  document.getElementById('tmdbApiKey').value = config.tmdb?.apiKey || '';
  document.getElementById('tmdbLanguage').value = config.tmdb?.language || 'en';

  // Session
  document.getElementById('sessionTimeout').value = Math.floor(
    (config.session?.timeoutMs || 300000) / 60000
  );
  document.getElementById('maxSearchResults').value = config.session?.maxSearchResults || 5;
  document.getElementById('unregisteredMessage').value = config.session?.unregisteredMessage || "You're not registered.\n\nYour {platform} ID: {id}\n\nShare this with your admin to get access!";

  // Quotas
  document.getElementById('quotasEnabled').checked = config.quotas?.enabled || false;
  document.getElementById('quotasPeriod').value = config.quotas?.period || 'weekly';
  document.getElementById('quotasMovieLimit').value = config.quotas?.movieLimit || 10;
  document.getElementById('quotasTvShowLimit').value = config.quotas?.tvShowLimit || 10;
  document.getElementById('quotasAdminExempt').checked = config.quotas?.adminExempt !== false;

  // Notifications
  document.getElementById('notificationsEnabled').checked = config.notifications?.enabled !== false;
  const platforms = config.notifications?.platforms || ['sms'];
  document.getElementById('notifyViaSms').checked = platforms.includes('sms');
  document.getElementById('notifyViaTelegram').checked = platforms.includes('telegram');
  document.getElementById('notifyViaDiscord').checked = platforms.includes('discord');
  document.getElementById('notifyViaSlack').checked = platforms.includes('slack');

  // Server
  document.getElementById('serverPort').value = config.server?.port || 3030;
  document.getElementById('serverExternalUrl').value = config.server?.externalUrl || '';
  document.getElementById('logLevel').value = config.server?.logLevel || 'info';

  // Download Notifications
  document.getElementById('downloadNotificationsEnabled').checked =
    config.downloadNotifications?.enabled !== false;
  document.getElementById('downloadNotificationsTemplate').value =
    config.downloadNotifications?.messageTemplate || '{emoji} {title} is ready to watch!';

  // Webhook secret display - fetch or generate if needed
  const webhookSecretDisplay = document.getElementById('webhookSecretDisplay');
  if (webhookSecretDisplay) {
    fetchWebhookSecret();
  }

  // Messages
  const msg = config.messages || {};
  document.getElementById('msgAcknowledgmentEnabled').checked = msg.acknowledgmentEnabled !== false;
  document.getElementById('msgAcknowledgment').value = msg.acknowledgment || '';
  document.getElementById('msgGenericError').value = msg.genericError || '';
  document.getElementById('msgUnknownCommand').value = msg.unknownCommand || '';
  document.getElementById('msgAddPrompt').value = msg.addPrompt || '';
  document.getElementById('msgCancelled').value = msg.cancelled || '';
  document.getElementById('msgRestart').value = msg.restart || '';
  document.getElementById('msgBackToStart').value = msg.backToStart || '';
  document.getElementById('msgNoResults').value = msg.noResults || '';
  document.getElementById('msgSearchResults').value = msg.searchResults || '';
  document.getElementById('msgSelectPrompt').value = msg.selectPrompt || '';
  document.getElementById('msgNoRecommendations').value = msg.noRecommendations || '';
  document.getElementById('msgSelectRange').value = msg.selectRange || '';
  document.getElementById('msgNothingToSelect').value = msg.nothingToSelect || '';
  document.getElementById('msgNothingToConfirm').value = msg.nothingToConfirm || '';
  document.getElementById('msgConfirmPrompt').value = msg.confirmPrompt || '';
  document.getElementById('msgConfirmAnimePrompt').value = msg.confirmAnimePrompt || '';
  document.getElementById('msgAnimeOrRegularPrompt').value = msg.animeOrRegularPrompt || '';
  document.getElementById('msgSeasonSelectPrompt').value = msg.seasonSelectPrompt || '';
  document.getElementById('msgSeasonConfirmPrompt').value = msg.seasonConfirmPrompt || '';
  document.getElementById('msgMediaAdded').value = msg.mediaAdded || '';
  document.getElementById('msgAlreadyAvailable').value = msg.alreadyAvailable || '';
  document.getElementById('msgAlreadyMonitored').value = msg.alreadyMonitored || '';
  document.getElementById('msgAlreadyPartial').value = msg.alreadyPartial || '';
  document.getElementById('msgAlreadyInLibrary').value = msg.alreadyInLibrary || '';
  document.getElementById('msgNothingDownloading').value = msg.nothingDownloading || '';
  document.getElementById('msgCurrentlyDownloading').value = msg.currentlyDownloading || '';
  document.getElementById('msgHelpText').value = msg.helpText || '';
  document.getElementById('msgAdminHelpText').value = msg.adminHelpText || '';

  // Update webhook URLs display
  updateArrWebhookUrls();
}

// Helper to set select value or add option if not exists
function setSelectValue(selectId, value) {
  const select = document.getElementById(selectId);
  const option = Array.from(select.options).find((o) => o.value == value);
  if (option) {
    select.value = value;
  } else {
    const newOption = document.createElement('option');
    newOption.value = value;
    newOption.textContent = value;
    select.appendChild(newOption);
    select.value = value;
  }
}

// Helper to get selected tag IDs from a tags container
function getSelectedTagIds(containerId) {
  const container = document.getElementById(containerId);
  const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(checkboxes).map((cb) => parseInt(cb.value));
}

// Update status badge
async function updateStatus() {
  const badge = document.getElementById('statusBadge');
  const statusText = badge.querySelector('.status-text');
  const alertBanner = document.getElementById('alertBanner');
  const alertText = document.getElementById('alertText');

  try {
    const response = await apiGet(`${API_BASE}/api/config`);
    const data = await response.json();

    if (data.status.complete) {
      badge.className = 'status-badge ready';
      statusText.textContent = 'Ready';
      alertBanner.style.display = 'none';
    } else {
      badge.className = 'status-badge';
      statusText.textContent = 'Setup Required';
      alertText.textContent = `Missing: ${data.status.missing.join(', ')}`;
      alertBanner.style.display = 'flex';
    }
  } catch (error) {
    badge.className = 'status-badge error';
    statusText.textContent = 'Error';
  }
}

// Fallback models when API is unavailable
const FALLBACK_MODELS = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  ],
  google: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ],
};

// Cache for fetched models
const modelsCache = {};

// Get API key for the selected provider
function getApiKeyForProvider(provider) {
  if (provider === 'openai') {
    return document.getElementById('openaiApiKey').value;
  } else if (provider === 'anthropic') {
    return document.getElementById('anthropicApiKey').value;
  } else if (provider === 'google') {
    return document.getElementById('googleApiKey').value;
  }
  return null;
}

// Populate model dropdown with options
function populateModelDropdown(select, models) {
  select.innerHTML = '';
  models.forEach((m) => {
    const option = document.createElement('option');
    option.value = m.value;
    option.textContent = m.label;
    select.appendChild(option);
  });

  // Add custom option at the end
  const customOption = document.createElement('option');
  customOption.value = '__custom__';
  customOption.textContent = '-- Custom Model --';
  select.appendChild(customOption);
}

// Update model options based on provider (async version)
async function updateModelOptions(forceRefresh = false) {
  const provider = document.getElementById('aiProvider').value;
  const modelSelect = document.getElementById('aiModel');
  const openaiGroup = document.getElementById('openaiKeyGroup');
  const anthropicGroup = document.getElementById('anthropicKeyGroup');
  const googleGroup = document.getElementById('googleKeyGroup');
  const customModelGroup = document.getElementById('customModelGroup');

  // Hide all key groups first
  openaiGroup.style.display = 'none';
  anthropicGroup.style.display = 'none';
  googleGroup.style.display = 'none';
  if (customModelGroup) customModelGroup.style.display = 'none';

  // Show relevant API key group
  if (provider === 'openai') {
    openaiGroup.style.display = 'block';
  } else if (provider === 'anthropic') {
    anthropicGroup.style.display = 'block';
  } else if (provider === 'google') {
    googleGroup.style.display = 'block';
  }

  // Check cache first (unless force refresh)
  const apiKey = getApiKeyForProvider(provider);
  // Include a hash of the API key to invalidate cache when key changes
  const keyHash = apiKey ? simpleHash(apiKey) : 'nokey';
  const cacheKey = `${provider}:${keyHash}`;

  if (!forceRefresh && modelsCache[cacheKey]) {
    populateModelDropdown(modelSelect, modelsCache[cacheKey]);
    restoreSelectedModel(modelSelect);
    return;
  }

  // Show loading state
  modelSelect.innerHTML = '<option value="">Loading models...</option>';
  modelSelect.disabled = true;

  try {
    if (apiKey) {
      const response = await apiPost(`${API_BASE}/api/config/ai-models`, { provider, apiKey });

      const data = await response.json();

      if (data.success && data.models && data.models.length > 0) {
        modelsCache[cacheKey] = data.models;
        populateModelDropdown(modelSelect, data.models);

        if (data.source === 'fallback') {
          console.log('Using fallback models for', provider);
        }
      } else {
        populateModelDropdown(modelSelect, FALLBACK_MODELS[provider] || []);
      }
    } else {
      // No API key, use fallback
      populateModelDropdown(modelSelect, FALLBACK_MODELS[provider] || []);
    }
  } catch (error) {
    console.error('Failed to fetch models:', error);
    populateModelDropdown(modelSelect, FALLBACK_MODELS[provider] || []);
    showToast('Could not fetch models, showing defaults', 'error');
  }

  modelSelect.disabled = false;
  restoreSelectedModel(modelSelect);
}

// Restore the currently selected model if it exists in the new list
function restoreSelectedModel(modelSelect) {
  if (currentConfig?.ai?.model) {
    const exists = Array.from(modelSelect.options).find((o) => o.value === currentConfig.ai.model);
    if (exists) {
      modelSelect.value = currentConfig.ai.model;
    } else {
      // Model not in list, set to custom
      modelSelect.value = '__custom__';
      handleModelChange();
    }
  }
}

// Handle model selection change (for custom model input)
function handleModelChange() {
  const modelSelect = document.getElementById('aiModel');
  const customModelGroup = document.getElementById('customModelGroup');
  const customModelInput = document.getElementById('customModel');

  if (modelSelect.value === '__custom__') {
    if (customModelGroup) {
      customModelGroup.style.display = 'block';
      // If we have a saved model that's not in the list, populate it
      if (
        currentConfig?.ai?.model &&
        !Array.from(modelSelect.options).find(
          (o) => o.value === currentConfig.ai.model && o.value !== '__custom__'
        )
      ) {
        customModelInput.value = currentConfig.ai.model;
      }
    }
  } else {
    if (customModelGroup) customModelGroup.style.display = 'none';
  }
}

// Refresh models (clears cache and re-fetches)
async function refreshModels() {
  const provider = document.getElementById('aiProvider').value;
  const apiKey = getApiKeyForProvider(provider);
  const cacheKey = `${provider}:${apiKey ? 'key' : 'nokey'}`;
  delete modelsCache[cacheKey];
  await updateModelOptions(true);
  showToast('Models refreshed', 'success');
}

// Get the selected model (handles custom model input)
function getSelectedModel() {
  const modelSelect = document.getElementById('aiModel');
  const customModelInput = document.getElementById('customModel');

  if (modelSelect.value === '__custom__' && customModelInput) {
    return customModelInput.value.trim() || modelSelect.options[0]?.value || '';
  }
  return modelSelect.value;
}

// Gather form data into config object
function gatherFormData() {
  return {
    server: {
      port: parseInt(document.getElementById('serverPort').value) || 3030,
      externalUrl: document.getElementById('serverExternalUrl').value.trim(),
      logLevel: document.getElementById('logLevel').value,
    },
    ai: {
      provider: document.getElementById('aiProvider').value,
      model: getSelectedModel(),
      openaiApiKey: document.getElementById('openaiApiKey').value,
      anthropicApiKey: document.getElementById('anthropicApiKey').value,
      googleApiKey: document.getElementById('googleApiKey').value,
      temperature: parseFloat(document.getElementById('aiTemperature').value) || 0.2,
      responseStyle: document.getElementById('aiResponseStyle').value,
      systemPrompt: document.getElementById('aiSystemPrompt').value,
    },
    twilio: {
      enabled: document.getElementById('twilioEnabled').checked,
      accountSid: document.getElementById('twilioAccountSid').value,
      authToken: document.getElementById('twilioAuthToken').value,
      phoneNumber: document.getElementById('twilioPhoneNumber').value,
      sendPosterImages: document.getElementById('twilioSendPosterImages').checked,
    },
    telegram: {
      enabled: document.getElementById('telegramEnabled').checked,
      botToken: document.getElementById('telegramBotToken').value,
      allowedChatIds: document.getElementById('telegramAllowedChatIds').value.split(',').map(s => s.trim()).filter(s => s),
      usePolling: document.getElementById('telegramUsePolling').checked,
      respondToUnregistered: document.getElementById('telegramRespondUnregistered').checked,
    },
    discord: {
      enabled: document.getElementById('discordEnabled').checked,
      botToken: document.getElementById('discordBotToken').value,
      allowedGuildIds: document.getElementById('discordAllowedGuildIds').value.split(',').map(s => s.trim()).filter(s => s),
      allowedChannelIds: document.getElementById('discordAllowedChannelIds').value.split(',').map(s => s.trim()).filter(s => s),
      respondToUnregistered: document.getElementById('discordRespondUnregistered').checked,
    },
    slack: {
      enabled: document.getElementById('slackEnabled').checked,
      botToken: document.getElementById('slackBotToken').value,
      signingSecret: document.getElementById('slackSigningSecret').value,
      useSocketMode: document.getElementById('slackUseSocketMode').checked,
      appToken: document.getElementById('slackAppToken').value,
      respondToUnregistered: document.getElementById('slackRespondUnregistered').checked,
    },
    sonarr: {
      url: document.getElementById('sonarrUrl').value,
      apiKey: document.getElementById('sonarrApiKey').value,
      qualityProfileId: parseInt(document.getElementById('sonarrQualityProfile').value) || 1,
      rootFolder: document.getElementById('sonarrRootFolder').value,
      animeRootFolder: document.getElementById('sonarrAnimeRootFolder').value || undefined,
      animeQualityProfileId:
        parseInt(document.getElementById('sonarrAnimeQualityProfile').value) || undefined,
      animeTagIds: getSelectedTagIds('sonarrAnimeTags'),
    },
    radarr: {
      url: document.getElementById('radarrUrl').value,
      apiKey: document.getElementById('radarrApiKey').value,
      qualityProfileId: parseInt(document.getElementById('radarrQualityProfile').value) || 1,
      rootFolder: document.getElementById('radarrRootFolder').value,
      animeRootFolder: document.getElementById('radarrAnimeRootFolder').value || undefined,
      animeQualityProfileId:
        parseInt(document.getElementById('radarrAnimeQualityProfile').value) || undefined,
      animeTagIds: getSelectedTagIds('radarrAnimeTags'),
    },
    prowlarr: {
      url: document.getElementById('prowlarrUrl').value,
      apiKey: document.getElementById('prowlarrApiKey').value,
    },
    tmdb: {
      apiKey: document.getElementById('tmdbApiKey').value,
      language: document.getElementById('tmdbLanguage').value,
    },
    session: {
      timeoutMs: parseInt(document.getElementById('sessionTimeout').value) * 60000 || 300000,
      maxSearchResults: parseInt(document.getElementById('maxSearchResults').value) || 5,
      unregisteredMessage: document.getElementById('unregisteredMessage').value || "You're not registered.\n\nYour {platform} ID: {id}\n\nShare this with your admin to get access!",
    },
    quotas: {
      enabled: document.getElementById('quotasEnabled').checked,
      period: document.getElementById('quotasPeriod').value,
      movieLimit: parseInt(document.getElementById('quotasMovieLimit').value) || 10,
      tvShowLimit: parseInt(document.getElementById('quotasTvShowLimit').value) || 10,
      adminExempt: document.getElementById('quotasAdminExempt').checked,
    },
    notifications: {
      enabled: document.getElementById('notificationsEnabled').checked,
      platforms: [
        document.getElementById('notifyViaSms').checked && 'sms',
        document.getElementById('notifyViaTelegram').checked && 'telegram',
        document.getElementById('notifyViaDiscord').checked && 'discord',
        document.getElementById('notifyViaSlack').checked && 'slack',
      ].filter(Boolean),
    },
    downloadNotifications: {
      enabled: document.getElementById('downloadNotificationsEnabled').checked,
      messageTemplate: document.getElementById('downloadNotificationsTemplate').value.trim() ||
        '{emoji} {title} is ready to watch!',
    },
    messages: {
      acknowledgmentEnabled: document.getElementById('msgAcknowledgmentEnabled').checked,
      acknowledgment: document.getElementById('msgAcknowledgment').value.trim() || undefined,
      genericError: document.getElementById('msgGenericError').value.trim() || undefined,
      unknownCommand: document.getElementById('msgUnknownCommand').value.trim() || undefined,
      addPrompt: document.getElementById('msgAddPrompt').value.trim() || undefined,
      cancelled: document.getElementById('msgCancelled').value.trim() || undefined,
      restart: document.getElementById('msgRestart').value.trim() || undefined,
      backToStart: document.getElementById('msgBackToStart').value.trim() || undefined,
      noResults: document.getElementById('msgNoResults').value.trim() || undefined,
      searchResults: document.getElementById('msgSearchResults').value.trim() || undefined,
      selectPrompt: document.getElementById('msgSelectPrompt').value.trim() || undefined,
      noRecommendations: document.getElementById('msgNoRecommendations').value.trim() || undefined,
      selectRange: document.getElementById('msgSelectRange').value.trim() || undefined,
      nothingToSelect: document.getElementById('msgNothingToSelect').value.trim() || undefined,
      nothingToConfirm: document.getElementById('msgNothingToConfirm').value.trim() || undefined,
      confirmPrompt: document.getElementById('msgConfirmPrompt').value.trim() || undefined,
      confirmAnimePrompt: document.getElementById('msgConfirmAnimePrompt').value.trim() || undefined,
      animeOrRegularPrompt: document.getElementById('msgAnimeOrRegularPrompt').value.trim() || undefined,
      seasonSelectPrompt: document.getElementById('msgSeasonSelectPrompt').value.trim() || undefined,
      seasonConfirmPrompt: document.getElementById('msgSeasonConfirmPrompt').value.trim() || undefined,
      mediaAdded: document.getElementById('msgMediaAdded').value.trim() || undefined,
      alreadyAvailable: document.getElementById('msgAlreadyAvailable').value.trim() || undefined,
      alreadyMonitored: document.getElementById('msgAlreadyMonitored').value.trim() || undefined,
      alreadyPartial: document.getElementById('msgAlreadyPartial').value.trim() || undefined,
      alreadyInLibrary: document.getElementById('msgAlreadyInLibrary').value.trim() || undefined,
      nothingDownloading: document.getElementById('msgNothingDownloading').value.trim() || undefined,
      currentlyDownloading: document.getElementById('msgCurrentlyDownloading').value.trim() || undefined,
      helpText: document.getElementById('msgHelpText').value.trim() || undefined,
      adminHelpText: document.getElementById('msgAdminHelpText').value.trim() || undefined,
    },
  };
}

// Save configuration
async function saveConfig() {
  // Debounce - prevent duplicate saves
  if (isSaving) return;

  const saveBtn = document.querySelector('.save-btn');
  const config = gatherFormData();

  // Clear previous validation errors
  clearValidationErrors();

  // Set loading state
  isSaving = true;
  if (saveBtn) {
    saveBtn.classList.add('saving');
    saveBtn.innerHTML = '<span>Saving...</span>';
  }

  try {
    const response = await apiPost(`${API_BASE}/api/config`, config);

    const data = await response.json();

    if (response.ok && data.success) {
      currentConfig = config;

      // Handle different response scenarios
      if (data.requiresRestart) {
        // Port change requires restart
        showToast('Configuration saved. Port change requires restart.', 'success');
      } else if (data.applied === true) {
        // Config was saved and applied successfully
        const serviceStatus = data.services
          ? ` (Sonarr: ${data.services.sonarr ? 'OK' : 'Failed'}, Radarr: ${data.services.radarr ? 'OK' : 'Failed'}, Prowlarr: ${data.services.prowlarr ? 'OK' : 'Failed'})`
          : '';
        showToast('Configuration saved and applied!' + serviceStatus, 'success');
      } else if (data.applied === false && data.errors) {
        // Config saved but failed to apply
        showToast('Saved but failed to apply: ' + data.errors.join(', '), 'error');
      } else {
        // Config saved (incomplete config, not applied)
        showToast('Configuration saved.', 'success');
      }

      await updateStatus();
      // Reset dirty state after successful save
      captureInitialState();
    } else {
      // Handle validation errors
      if (data.details && Array.isArray(data.details)) {
        displayValidationErrors(data.details);
        showToast('Please fix the validation errors', 'error');
      } else {
        showToast(data.error || 'Failed to save configuration', 'error');
      }
    }
  } catch (error) {
    console.error('Failed to save config:', error);
    showToast('Failed to save configuration', 'error');
  } finally {
    // Reset loading state
    isSaving = false;
    if (saveBtn) {
      saveBtn.classList.remove('saving');
      saveBtn.innerHTML = '<span>💾</span> Save Configuration';
      updateDirtyIndicator();
    }
  }
}

// Test connection to Sonarr/Radarr
async function testConnection(type) {
  const url = document.getElementById(`${type}Url`).value;
  const apiKey = document.getElementById(`${type}ApiKey`).value;
  if (!url || !apiKey) return showToast(`Please enter ${type} URL and API key`, 'error');
  await testService('test-connection', { type, url, apiKey }, 'Connection test failed');
}

// Load system prompt - fetch default if no custom prompt saved
let defaultSystemPrompt = '';

async function loadSystemPrompt(savedPrompt) {
  const textarea = document.getElementById('aiSystemPrompt');
  if (!textarea) return;

  // If we have a saved prompt, use it
  if (savedPrompt?.trim()) {
    textarea.value = savedPrompt;
    return;
  }

  // Otherwise fetch the default
  try {
    const response = await fetch(`${API_BASE}/api/config/default-system-prompt`, {
      credentials: 'include',
      headers: { 'x-csrf-token': csrfToken }
    });
    if (response.ok) {
      const data = await response.json();
      defaultSystemPrompt = data.prompt;
      textarea.value = data.prompt;
    }
  } catch (error) {
    console.error('Failed to load default system prompt:', error);
  }
}

// Reset system prompt to default
async function resetSystemPrompt() {
  const textarea = document.getElementById('aiSystemPrompt');
  if (!textarea) return;

  // If we already have the default cached, use it
  if (defaultSystemPrompt) {
    textarea.value = defaultSystemPrompt;
    showToast('Reset to default prompt', 'success');
    return;
  }

  // Otherwise fetch it
  try {
    const response = await fetch(`${API_BASE}/api/config/default-system-prompt`, {
      credentials: 'include',
      headers: { 'x-csrf-token': csrfToken }
    });
    if (response.ok) {
      const data = await response.json();
      defaultSystemPrompt = data.prompt;
      textarea.value = data.prompt;
      showToast('Reset to default prompt', 'success');
    }
  } catch (error) {
    showToast('Failed to fetch default prompt', 'error');
  }
}

// Reset all messages to defaults (clear fields to use schema defaults)
function resetMessages() {
  // Clear all message fields to empty (will use schema defaults)
  document.getElementById('msgAcknowledgment').value = '';
  document.getElementById('msgGenericError').value = '';
  document.getElementById('msgUnknownCommand').value = '';
  document.getElementById('msgAddPrompt').value = '';
  document.getElementById('msgCancelled').value = '';
  document.getElementById('msgRestart').value = '';
  document.getElementById('msgBackToStart').value = '';
  document.getElementById('msgNoResults').value = '';
  document.getElementById('msgSearchResults').value = '';
  document.getElementById('msgSelectPrompt').value = '';
  document.getElementById('msgSelectRange').value = '';
  document.getElementById('msgNothingToSelect').value = '';
  document.getElementById('msgNothingToConfirm').value = '';
  document.getElementById('msgConfirmPrompt').value = '';
  document.getElementById('msgConfirmAnimePrompt').value = '';
  document.getElementById('msgAnimeOrRegularPrompt').value = '';
  document.getElementById('msgSeasonSelectPrompt').value = '';
  document.getElementById('msgSeasonConfirmPrompt').value = '';
  document.getElementById('msgMediaAdded').value = '';
  document.getElementById('msgAlreadyAvailable').value = '';
  document.getElementById('msgAlreadyMonitored').value = '';
  document.getElementById('msgAlreadyPartial').value = '';
  document.getElementById('msgAlreadyInLibrary').value = '';
  document.getElementById('msgNothingDownloading').value = '';
  document.getElementById('msgCurrentlyDownloading').value = '';
  document.getElementById('msgHelpText').value = '';
  document.getElementById('msgAdminHelpText').value = '';
  showToast('Messages reset to defaults. Save to apply.', 'success');
}

// Test AI configuration
async function testAI() {
  const provider = document.getElementById('aiProvider').value;
  const model = document.getElementById('aiModel').value;
  const apiKeyMap = {
    openai: 'openaiApiKey',
    anthropic: 'anthropicApiKey',
    google: 'googleApiKey',
  };
  const apiKey = document.getElementById(apiKeyMap[provider])?.value;
  if (!apiKey) return showToast('Please enter an API key', 'error');
  await testService('test-ai', { provider, model, apiKey }, 'AI test failed');
}

// Test Twilio credentials
async function testTwilio() {
  const accountSid = document.getElementById('twilioAccountSid').value;
  const authToken = document.getElementById('twilioAuthToken').value;
  const phoneNumber = document.getElementById('twilioPhoneNumber').value;
  if (!accountSid || !authToken) return showToast('Please enter Account SID and Auth Token', 'error');
  await testService('test-twilio', { accountSid, authToken, phoneNumber }, 'Twilio test failed');
}

// Test TMDB API key
async function testTMDB() {
  const apiKey = document.getElementById('tmdbApiKey').value;
  if (!apiKey) return showToast('Please enter a TMDB API key', 'error');
  await testService('test-tmdb', { apiKey }, 'TMDB test failed');
}

// Fetch Sonarr options
async function fetchSonarrOptions() {
  const url = document.getElementById('sonarrUrl').value;
  const apiKey = document.getElementById('sonarrApiKey').value;

  if (!url || !apiKey) {
    showToast('Please enter Sonarr URL and API key first', 'error');
    return;
  }

  await fetchOptions('sonarr', url, apiKey);
}

// Fetch Radarr options
async function fetchRadarrOptions() {
  const url = document.getElementById('radarrUrl').value;
  const apiKey = document.getElementById('radarrApiKey').value;

  if (!url || !apiKey) {
    showToast('Please enter Radarr URL and API key first', 'error');
    return;
  }

  await fetchOptions('radarr', url, apiKey);
}

// Fetch quality profiles, root folders, and tags
async function fetchOptions(type, url, apiKey) {
  try {
    // Ensure CSRF token is fetched before parallel requests
    await getCsrfToken();

    // Fetch all options in parallel
    const [profilesResponse, foldersResponse, tagsResponse] = await Promise.all([
      apiPost(`${API_BASE}/api/config/quality-profiles`, { type, url, apiKey }),
      apiPost(`${API_BASE}/api/config/root-folders`, { type, url, apiKey }),
      apiPost(`${API_BASE}/api/config/tags`, { type, url, apiKey }),
    ]);

    const [profilesData, foldersData, tagsData] = await Promise.all([
      profilesResponse.json(),
      foldersResponse.json(),
      tagsResponse.json(),
    ]);

    // Update quality profile dropdowns
    if (profilesData.success && profilesData.profiles.length > 0) {
      populateSelect(`${type}QualityProfile`, profilesData.profiles);
      populateSelect(`${type}AnimeQualityProfile`, profilesData.profiles, { defaultOption: 'Same as default' });
    }

    // Update root folder dropdowns
    if (foldersData.success && foldersData.folders.length > 0) {
      populateSelect(`${type}RootFolder`, foldersData.folders, { valueKey: 'path', labelKey: 'path' });
      populateSelect(`${type}AnimeRootFolder`, foldersData.folders, { valueKey: 'path', labelKey: 'path', defaultOption: 'Same as default' });
    }

    // Update tags
    const tagsContainer = document.getElementById(`${type}AnimeTags`);
    if (tagsData.success && tagsData.tags.length > 0) {
      const selectedTags = currentConfig?.[type]?.animeTagIds || [];
      tagsContainer.innerHTML = tagsData.tags
        .map(
          (tag) => `
        <label class="tag-checkbox">
          <input type="checkbox" value="${tag.id}" ${selectedTags.includes(tag.id) ? 'checked' : ''}>
          <span>${escapeHtml(tag.label)}</span>
        </label>
      `
        )
        .join('');
    } else {
      tagsContainer.innerHTML = '<span class="tags-empty">No tags found in ' + type + '.</span>';
    }

    showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} options loaded`, 'success');
  } catch (error) {
    showToast(`Failed to fetch ${type} options`, 'error');
  }
}

// Hide alert banner
function hideAlert() {
  document.getElementById('alertBanner').style.display = 'none';
}

// Toggle collapsible section
function toggleCollapsible(button) {
  const content = button.nextElementSibling;
  const isExpanded = content.style.display !== 'none';

  content.style.display = isExpanded ? 'none' : 'block';
  button.classList.toggle('expanded', !isExpanded);
}

// ============================================
// User Management Functions
// ============================================

// Handle user table action clicks via event delegation
function handleUserTableAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const userId = button.dataset.userId;
  const isAdmin = button.dataset.isAdmin === 'true';

  switch (action) {
    case 'edit':
      showEditUserForm(userId);
      break;
    case 'toggle-admin':
      toggleUserAdmin(userId, !isAdmin);
      break;
    case 'reset-quota':
      resetUserQuota(userId);
      break;
    case 'delete':
      deleteUser(userId);
      break;
    case 'save-add':
      addUser();
      break;
    case 'cancel-add':
      cancelAddUser();
      break;
    case 'save-edit':
      saveEditUser(userId);
      break;
    case 'cancel-edit':
      cancelEditUser();
      break;
  }
}

// Load users from server
async function loadUsers() {
  try {
    const response = await apiGet(`${API_BASE}/api/users`);
    const data = await response.json();
    users = data.users || [];
    renderUsersTable();
  } catch (error) {
    console.error('Failed to load users:', error);
    users = [];
    renderUsersTable();
  }
}

// Render users table
function renderUsersTable() {
  const tbody = document.getElementById('usersTableBody');
  const emptyState = document.getElementById('usersEmpty');
  const table = document.getElementById('usersTable');

  if (users.length === 0) {
    table.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }

  table.style.display = 'table';
  emptyState.style.display = 'none';

  tbody.innerHTML = users
    .map(
      (user) => `
    <tr data-user-id="${escapeHtml(user.id)}">
      <td><span class="user-name">${escapeHtml(user.name)}</span></td>
      <td><span class="user-identities">${formatUserIdentities(user.identities)}</span></td>
      <td>${user.isAdmin ? '<span class="admin-badge">Admin</span>' : 'User'}</td>
      <td><span class="user-stats">${user.requestCount?.movies || 0} movies, ${user.requestCount?.tvShows || 0} TV</span></td>
      <td>
        <div class="user-actions">
          <button class="user-action-btn" data-action="edit" data-user-id="${escapeHtml(user.id)}" title="Edit User">
            ✏️
          </button>
          <button class="user-action-btn" data-action="toggle-admin" data-user-id="${escapeHtml(user.id)}" data-is-admin="${user.isAdmin}" title="${user.isAdmin ? 'Demote to User' : 'Promote to Admin'}">
            ${user.isAdmin ? '👤' : '👑'}
          </button>
          <button class="user-action-btn" data-action="reset-quota" data-user-id="${escapeHtml(user.id)}" title="Reset Quota">
            🔄
          </button>
          <button class="user-action-btn danger" data-action="delete" data-user-id="${escapeHtml(user.id)}" title="Delete User">
            🗑️
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join('');
}

// Format user identities as badges
function formatUserIdentities(identities) {
  if (!identities) return '<span class="identity-badge">No identities</span>';

  const badges = [];
  if (identities.sms) badges.push(`<span class="identity-badge sms">📱 ${escapeHtml(identities.sms)}</span>`);
  if (identities.telegram) badges.push(`<span class="identity-badge telegram">💬 TG:${escapeHtml(identities.telegram)}</span>`);
  if (identities.discord) badges.push(`<span class="identity-badge discord">🎮 DC:${escapeHtml(identities.discord)}</span>`);
  if (identities.slack) badges.push(`<span class="identity-badge slack">💼 SL:${escapeHtml(identities.slack)}</span>`);

  return badges.length > 0 ? badges.join(' ') : '<span class="identity-badge">No identities</span>';
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Track which user is being edited (prevents concurrent edits)
let editingUserId = null;

// Create user form row (shared between add and edit)
function createUserFormRow(mode, user = null) {
  const isEdit = mode === 'edit';
  const nameId = isEdit ? 'editUserName' : 'newUserName';
  const smsId = isEdit ? 'editUserSms' : 'newUserSms';
  const telegramId = isEdit ? 'editUserTelegram' : 'newUserTelegram';
  const discordId = isEdit ? 'editUserDiscord' : 'newUserDiscord';
  const slackId = isEdit ? 'editUserSlack' : 'newUserSlack';
  const adminId = isEdit ? 'editUserAdmin' : 'newUserAdmin';
  const saveAction = isEdit ? 'save-edit' : 'save-add';
  const cancelAction = isEdit ? 'cancel-edit' : 'cancel-add';
  const userIdData = isEdit ? ` data-user-id="${escapeHtml(user.id)}"` : '';

  return `
    <td><input type="text" id="${nameId}" placeholder="Name" value="${isEdit ? escapeHtml(user.name) : ''}" /></td>
    <td class="identities-cell">
      <div class="identity-inputs">
        <input type="tel" id="${smsId}" placeholder="📱 SMS (5551234567, +1 auto)" value="${isEdit && user.identities?.sms ? escapeHtml(user.identities.sms) : ''}" />
        <input type="text" id="${telegramId}" placeholder="💬 Telegram ID" value="${isEdit && user.identities?.telegram ? escapeHtml(user.identities.telegram) : ''}" />
        <input type="text" id="${discordId}" placeholder="🎮 Discord ID" value="${isEdit && user.identities?.discord ? escapeHtml(user.identities.discord) : ''}" />
        <input type="text" id="${slackId}" placeholder="💼 Slack ID" value="${isEdit && user.identities?.slack ? escapeHtml(user.identities.slack) : ''}" />
      </div>
    </td>
    <td>
      <label class="toggle-label">
        <input type="checkbox" id="${adminId}" ${isEdit && user.isAdmin ? 'checked' : ''}>
        <span class="toggle-switch"></span>
        <span class="toggle-text">Admin</span>
      </label>
    </td>
    <td>—</td>
    <td>
      <div class="user-actions">
        <button class="user-action-btn" data-action="${saveAction}"${userIdData} title="Save">✓</button>
        <button class="user-action-btn danger" data-action="${cancelAction}"${userIdData} title="Cancel">✕</button>
      </div>
    </td>
  `;
}

// Show add user form
function showAddUserForm() {
  const tbody = document.getElementById('usersTableBody');
  const table = document.getElementById('usersTable');
  const emptyState = document.getElementById('usersEmpty');

  // Show table if hidden
  table.style.display = 'table';
  emptyState.style.display = 'none';

  // Check if form row already exists or if editing
  if (document.getElementById('addUserRow') || editingUserId) {
    return;
  }

  const formRow = document.createElement('tr');
  formRow.id = 'addUserRow';
  formRow.className = 'add-user-row';
  formRow.innerHTML = createUserFormRow('add');

  tbody.insertBefore(formRow, tbody.firstChild);
  document.getElementById('newUserName').focus();
}

// Cancel add user form
function cancelAddUser() {
  const formRow = document.getElementById('addUserRow');
  if (formRow) {
    formRow.remove();
  }
  // Re-render in case table was empty
  renderUsersTable();
}

// Show edit user form
function showEditUserForm(userId) {
  // Prevent concurrent edits
  if (editingUserId || document.getElementById('addUserRow')) {
    return;
  }

  const user = users.find((u) => u.id === userId);
  if (!user) {
    showToast('User not found', 'error');
    return;
  }

  editingUserId = userId;
  const row = document.querySelector(`tr[data-user-id="${userId}"]`);
  if (!row) return;

  row.id = 'editUserRow';
  row.className = 'edit-user-row';
  row.innerHTML = createUserFormRow('edit', user);
  document.getElementById('editUserName').focus();
}

// Cancel edit user form
function cancelEditUser() {
  editingUserId = null;
  renderUsersTable();
}

// Save edited user
async function saveEditUser(userId) {
  const name = document.getElementById('editUserName').value.trim();
  const isAdmin = document.getElementById('editUserAdmin').checked;

  // Gather identities
  let sms = document.getElementById('editUserSms').value.trim();
  const telegram = document.getElementById('editUserTelegram').value.trim();
  const discord = document.getElementById('editUserDiscord').value.trim();
  const slack = document.getElementById('editUserSlack').value.trim();

  if (!name) {
    showToast('Please enter a name', 'error');
    return;
  }

  // Normalize SMS: strip special chars and auto-prepend +1 if no country code
  if (sms) {
    const hasCountryCode = sms.startsWith('+');
    const digits = sms.replace(/\D/g, '');
    sms = hasCountryCode ? '+' + digits : '+1' + digits;
  }

  const identities = {};
  if (sms) identities.sms = sms;
  if (telegram) identities.telegram = telegram;
  if (discord) identities.discord = discord;
  if (slack) identities.slack = slack;

  if (Object.keys(identities).length === 0) {
    showToast('Please provide at least one identity', 'error');
    return;
  }

  try {
    const response = await apiPut(`${API_BASE}/api/users/${encodeURIComponent(userId)}`, { name, identities, isAdmin });

    const data = await response.json();

    if (response.ok && data.success) {
      showToast('User updated successfully', 'success');
      editingUserId = null;
      await loadUsers();
    } else if (response.status === 409) {
      showToast(data.error || 'Identity already in use', 'error');
    } else {
      showToast(data.error || 'Failed to update user', 'error');
    }
  } catch (error) {
    showToast('Failed to update user', 'error');
  }
}

// Add new user
async function addUser() {
  const name = document.getElementById('newUserName').value.trim();
  const isAdmin = document.getElementById('newUserAdmin').checked;

  // Gather identities
  let sms = document.getElementById('newUserSms').value.trim();
  const telegram = document.getElementById('newUserTelegram').value.trim();
  const discord = document.getElementById('newUserDiscord').value.trim();
  const slack = document.getElementById('newUserSlack').value.trim();

  if (!name) {
    showToast('Please enter a name', 'error');
    return;
  }

  // Normalize SMS: strip special chars and auto-prepend +1 if no country code
  if (sms) {
    const hasCountryCode = sms.startsWith('+');
    const digits = sms.replace(/\D/g, '');
    sms = hasCountryCode ? '+' + digits : '+1' + digits;
  }

  const identities = {};
  if (sms) identities.sms = sms;
  if (telegram) identities.telegram = telegram;
  if (discord) identities.discord = discord;
  if (slack) identities.slack = slack;

  if (Object.keys(identities).length === 0) {
    showToast('Please provide at least one identity', 'error');
    return;
  }

  try {
    const response = await apiPost(`${API_BASE}/api/users`, { name, identities, isAdmin });

    const data = await response.json();

    if (response.ok && data.success) {
      showToast(`User ${name} added successfully`, 'success');
      await loadUsers();
      await updateStatus();
    } else {
      showToast(data.error || 'Failed to add user', 'error');
    }
  } catch (error) {
    showToast('Failed to add user', 'error');
  }
}

// Delete user
async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user?')) {
    return;
  }

  try {
    const response = await apiDelete(`${API_BASE}/api/users/${encodeURIComponent(userId)}`);

    const data = await response.json();

    if (response.ok && data.success) {
      showToast('User deleted', 'success');
      await loadUsers();
      await updateStatus();
    } else {
      showToast(data.error || 'Failed to delete user', 'error');
    }
  } catch (error) {
    showToast('Failed to delete user', 'error');
  }
}

// Toggle user admin status
async function toggleUserAdmin(userId, isAdmin) {
  try {
    const response = await apiPut(`${API_BASE}/api/users/${encodeURIComponent(userId)}`, { isAdmin });

    const data = await response.json();

    if (response.ok && data.success) {
      showToast(`User ${isAdmin ? 'promoted to admin' : 'demoted to user'}`, 'success');
      await loadUsers();
    } else {
      showToast(data.error || 'Failed to update user', 'error');
    }
  } catch (error) {
    showToast('Failed to update user', 'error');
  }
}

// Reset user quota
async function resetUserQuota(userId) {
  if (!confirm("Reset this user's request quota?")) {
    return;
  }

  try {
    const response = await apiPost(`${API_BASE}/api/users/${encodeURIComponent(userId)}/reset-quota`, {});

    const data = await response.json();

    if (response.ok && data.success) {
      showToast('Quota reset successfully', 'success');
      await loadUsers();
    } else {
      showToast(data.error || 'Failed to reset quota', 'error');
    }
  } catch (error) {
    showToast('Failed to reset quota', 'error');
  }
}

// Show toast notification
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  const toastIcon = document.getElementById('toastIcon');
  const toastMessage = document.getElementById('toastMessage');

  toastIcon.textContent = type === 'success' ? '✓' : '✗';
  toastMessage.textContent = message;
  toast.className = `toast ${type} show`;

  setTimeout(() => {
    toast.className = 'toast';
  }, 4000);
}
