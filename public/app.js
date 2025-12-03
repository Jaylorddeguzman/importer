// Configuration
const REFRESH_INTERVAL = 5000; // 5 seconds
const DATA_REFRESH_INTERVAL = 30000; // 30 seconds
let autoRefresh = true;
let currentPage = 1;
const itemsPerPage = 10;

// State
let statsData = null;
let recentData = [];

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

async function initializeApp() {
    addLog('Dashboard initialized', 'success');
    
    // Initial data fetch
    await fetchStats();
    await fetchRecentData();
    
    // Setup auto-refresh
    setInterval(() => {
        if (autoRefresh) {
            fetchStats();
        }
    }, REFRESH_INTERVAL);
    
    setInterval(() => {
        if (autoRefresh) {
            fetchRecentData();
        }
    }, DATA_REFRESH_INTERVAL);
    
    // Setup event listeners
    setupEventListeners();
}

function setupEventListeners() {
    const refreshDataBtn = document.getElementById('refreshDataBtn');
    const clearLogBtn = document.getElementById('clearLogBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    
    refreshDataBtn?.addEventListener('click', async () => {
        refreshDataBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
        await fetchRecentData();
        refreshDataBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
    });
    
    clearLogBtn?.addEventListener('click', () => {
        const activityLog = document.getElementById('activityLog');
        activityLog.innerHTML = '<div class="log-entry"><span class="log-time">[' + getCurrentTime() + ']</span><span class="log-message">Log cleared</span></div>';
    });
    
    prevBtn?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderDataTable();
        }
    });
    
    nextBtn?.addEventListener('click', () => {
        const totalPages = Math.ceil(recentData.length / itemsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            renderDataTable();
        }
    });
}

// Fetch stats from API
async function fetchStats() {
    try {
        const response = await fetch('/stats');
        if (!response.ok) throw new Error('Failed to fetch stats');
        
        statsData = await response.json();
        updateUI(statsData);
        updateServiceBadge('running');
        
    } catch (error) {
        console.error('Error fetching stats:', error);
        updateServiceBadge('error');
        addLog('Failed to fetch stats: ' + error.message, 'error');
    }
}

// Fetch recent data from database
async function fetchRecentData() {
    try {
        const response = await fetch('/api/recent');
        if (!response.ok) throw new Error('Failed to fetch data');
        
        const data = await response.json();
        recentData = data.establishments || [];
        currentPage = 1;
        renderDataTable();
        
        addLog(`Loaded ${recentData.length} establishments`, 'success');
        
    } catch (error) {
        console.error('Error fetching data:', error);
        addLog('Failed to fetch recent data: ' + error.message, 'error');
    }
}

// Update UI with stats data
function updateUI(data) {
    if (!data) return;
    
    // Update stats cards
    document.getElementById('totalImported').textContent = formatNumber(data.progress?.totalImported || 0);
    document.getElementById('cycleCount').textContent = formatNumber(data.progress?.cycleCount || 0);
    document.getElementById('uptime').textContent = formatUptime(data.progress?.uptime || 0);
    document.getElementById('errorCount').textContent = formatNumber(data.progress?.errors || 0);
    
    // Update current progress
    document.getElementById('currentProvince').textContent = data.state?.currentProvince || '-';
    document.getElementById('currentType').textContent = data.state?.currentType || '-';
    
    const lastImportTime = data.progress?.lastImportTime;
    document.getElementById('lastImportTime').textContent = lastImportTime 
        ? formatTimeAgo(new Date(lastImportTime))
        : 'Never';
    
    // Update progress bars
    const provinceIndex = data.state?.currentProvinceIndex || 0;
    const totalProvinces = data.state?.totalProvinces || 1;
    const typeIndex = data.state?.currentTypeIndex || 0;
    const totalTypes = data.state?.totalTypes || 1;
    
    const provinceProgress = ((provinceIndex + 1) / totalProvinces) * 100;
    const typeProgress = ((typeIndex + 1) / totalTypes) * 100;
    
    document.getElementById('provinceBar').style.width = provinceProgress + '%';
    document.getElementById('typeBar').style.width = typeProgress + '%';
    
    document.getElementById('provinceProgress').textContent = `${provinceIndex + 1}/${totalProvinces}`;
    document.getElementById('typeProgress').textContent = `${typeIndex + 1}/${totalTypes}`;
    
    // Update keep-alive status
    const keepAliveEnabled = data.keepAlive?.enabled || false;
    const keepAliveElem = document.getElementById('keepAliveEnabled');
    keepAliveElem.textContent = keepAliveEnabled ? 'Yes' : 'No';
    keepAliveElem.className = 'badge ' + (keepAliveEnabled ? 'badge-success' : 'badge-danger');
    
    document.getElementById('pingCount').textContent = formatNumber(data.keepAlive?.pings || 0);
    document.getElementById('pingInterval').textContent = data.keepAlive?.interval || '-';
    
    // Update configuration
    document.getElementById('importMode').textContent = data.state?.mode || '-';
    
    const isRunning = data.state?.isRunning || false;
    const runningElem = document.getElementById('isRunning');
    runningElem.textContent = isRunning ? 'Running' : 'Stopped';
    runningElem.className = 'badge ' + (isRunning ? 'badge-success' : 'badge-danger');
    
    document.getElementById('totalProvinces').textContent = totalProvinces;
    document.getElementById('totalTypes').textContent = totalTypes;
    
    // Update last update time
    document.getElementById('lastUpdate').textContent = getCurrentTime();
}

// Render data table
function renderDataTable() {
    const tbody = document.getElementById('dataTableBody');
    
    if (recentData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="no-data"><i class="fas fa-inbox"></i> No data available</td></tr>';
        updatePagination(0);
        return;
    }
    
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageData = recentData.slice(startIndex, endIndex);
    
    tbody.innerHTML = pageData.map(item => `
        <tr>
            <td><strong>${escapeHtml(item.name || 'N/A')}</strong></td>
            <td><span class="badge badge-secondary">${escapeHtml(item.category || 'N/A')}</span></td>
            <td>${escapeHtml(item.address || 'N/A')}</td>
            <td>${item.latitude?.toFixed(6) || 'N/A'}, ${item.longitude?.toFixed(6) || 'N/A'}</td>
            <td>${formatDate(item.addedAt)}</td>
        </tr>
    `).join('');
    
    updatePagination(recentData.length);
}

// Update pagination controls
function updatePagination(totalItems) {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    
    document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages || 1}`;
    document.getElementById('prevBtn').disabled = currentPage <= 1;
    document.getElementById('nextBtn').disabled = currentPage >= totalPages;
}

// Update service status badge
function updateServiceBadge(status) {
    const badge = document.getElementById('serviceBadge');
    const statusText = badge.querySelector('.status-text');
    
    badge.className = 'status-badge ' + status;
    
    if (status === 'running') {
        statusText.textContent = 'Running';
    } else if (status === 'error') {
        statusText.textContent = 'Error';
    } else {
        statusText.textContent = 'Checking...';
    }
}

// Add log entry
function addLog(message, type = '') {
    const activityLog = document.getElementById('activityLog');
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry ' + type;
    
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = '[' + getCurrentTime() + ']';
    
    const msg = document.createElement('span');
    msg.className = 'log-message';
    msg.textContent = message;
    
    logEntry.appendChild(time);
    logEntry.appendChild(msg);
    
    activityLog.appendChild(logEntry);
    activityLog.scrollTop = activityLog.scrollHeight;
    
    // Keep only last 50 entries
    while (activityLog.children.length > 50) {
        activityLog.removeChild(activityLog.firstChild);
    }
}

// Utility functions
function formatNumber(num) {
    return new Intl.NumberFormat().format(num);
}

function formatUptime(seconds) {
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
    return Math.floor(seconds / 86400) + 'd';
}

function formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return seconds + 's ago';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
    return Math.floor(seconds / 86400) + 'd ago';
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleString();
}

function getCurrentTime() {
    return new Date().toLocaleTimeString();
}

function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}
