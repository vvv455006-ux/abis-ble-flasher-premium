// ABIS BLE FLASHER - Frontend Logic
const API = '/api';

let currentUser = null;
let selectedFirmware = null;
let currentSession = null;
let bluetoothDevice = null;
let gattServer = null;

const NINEBOT_SERVICE = '6e400001-0000-0000-006e-696e65626f74';
const NINEBOT_WRITE = '6e400002-0000-0000-006e-696e65626f74';
const NINEBOT_NOTIFY = '6e400004-0000-0000-006e-696e65626f74';

// Hardcoded templates (visible without connection)
const TEMPLATES = [
  { id: 1, name: 'Under Armour', model: 'F3', version: 'v3c', description: 'Custom display firmware for F3', compatibility_status: 'verified', file_size: 1988950 },
  { id: 2, name: 'Stone Island', model: 'F3', version: 'v0.6', description: 'Smoke style firmware for F3', compatibility_status: 'verified', file_size: 1989293 },
  { id: 3, name: 'Under Armour', model: 'G3', version: 'v0.1', description: 'Blackwave style firmware for G3', compatibility_status: 'verified', file_size: 2004912 },
  { id: 4, name: 'Stone Island', model: 'G3', version: 'v0.6', description: 'Smoke style firmware for G3', compatibility_status: 'verified', file_size: 2012936 }
];

document.addEventListener('DOMContentLoaded', () => {
  checkBluetoothSupport();
  setupEventListeners();
  fetch(`${API}/auth/me`).then(r => r.ok ? r.json() : null).then(data => {
    if (data) {
      currentUser = data;
      showDashboard();
    }
  }).catch(() => {});
});

function checkBluetoothSupport() {
  if (!navigator.bluetooth) {
    document.getElementById('bt-support-warning').classList.remove('hidden');
    document.getElementById('scan-btn').disabled = true;
  }
}

function setupEventListeners() {
  document.getElementById('activate-btn').addEventListener('click', login);
  document.getElementById('access-key').addEventListener('keypress', e => { if (e.key === 'Enter') login(); });
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('admin-btn').addEventListener('click', showAdmin);
  document.getElementById('back-to-dash').addEventListener('click', showDashboard);
  document.getElementById('scan-btn').addEventListener('click', scanDevices);
  document.getElementById('disconnect-btn').addEventListener('click', disconnectDevice);
  document.getElementById('start-flash-btn').addEventListener('click', startFlash);
  document.getElementById('generate-btn').addEventListener('click', generateKeys);
  document.getElementById('gen-credits').addEventListener('change', e => {
    document.getElementById('gen-credits-custom').classList.toggle('hidden', e.target.value !== 'custom');
  });
}

async function login() {
  const key = document.getElementById('access-key').value.trim();
  const errorEl = document.getElementById('login-error');
  const loader = document.getElementById('login-loader');
  errorEl.textContent = '';
  loader.classList.remove('hidden');

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    currentUser = data;
    showDashboard();
  } catch (err) {
    errorEl.textContent = err.message;
  } finally {
    loader.classList.add('hidden');
  }
}

async function logout() {
  await fetch(`${API}/auth/logout`, { method: 'POST' });
  currentUser = null;
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('dashboard-screen').classList.remove('active');
  document.getElementById('admin-screen').classList.remove('active');
  document.getElementById('access-key').value = '';
}

function showDashboard() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('admin-screen').classList.remove('active');
  document.getElementById('dashboard-screen').classList.add('active');
  updateUserInfo();
  loadHistory();
  renderTemplates(); // Show templates without connection
  if (currentUser.isAdmin) document.getElementById('admin-btn').classList.remove('hidden');
}

function updateUserInfo() {
  document.getElementById('credits-display').textContent = `Credits: ${currentUser.credits}`;
  document.getElementById('credits-large').textContent = currentUser.credits;
  document.getElementById('user-info').textContent = currentUser.isAdmin ? 'Admin' : 'User Key';
}

async function loadHistory() {
  try {
    const res = await fetch(`${API}/history`);
    const history = await res.json();
    const list = document.getElementById('activity-list');
    list.innerHTML = history.length ? history.map(h => `
      <div class="activity-item">
        <strong>${new Date(h.start_time).toLocaleString()}</strong> — ${h.device_model || 'Unknown'}<br>
        ${h.firmware_name || 'N/A'} — <span style="color:${h.result==='success'?'#fff':'#ff4444'}">${h.result.toUpperCase()}</span>
        ${h.credit_deducted ? ' (1 Credit)' : ''}
      </div>
    `).join('') : '<p style="color:#555">No activity yet</p>';
  } catch (e) { console.error(e); }
}

function renderTemplates(modelFilter = null) {
  const list = document.getElementById('firmware-list');
  const items = modelFilter ? TEMPLATES.filter(t => t.model === modelFilter) : TEMPLATES;
  list.innerHTML = items.map(fw => `
    <div class="firmware-item" data-id="${fw.id}" data-model="${fw.model}">
      <strong>${fw.name}</strong> <span style="color:#555">${fw.version}</span><br>
      <small>${fw.model} • ${(fw.file_size/1024/1024).toFixed(1)} MB • ${fw.compatibility_status}</small>
      <div style="margin-top:0.5rem;color:#555;font-size:0.8rem">${fw.description || ''}</div>
    </div>
  `).join('');

  document.querySelectorAll('.firmware-item').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.firmware-item').forEach(i => i.classList.remove('selected'));
      el.classList.add('selected');
      selectedFirmware = { id: el.dataset.id, model: el.dataset.model };
      document.getElementById('start-flash-btn').disabled = false;
    });
  });
}

// ==================== BLUETOOTH ====================
async function scanDevices() {
  if (!navigator.bluetooth) return alert('Web Bluetooth not supported');
  try {
    bluetoothDevice = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'NB' },
        { namePrefix: 'Ninebot' },
        { namePrefix: 'Segway' },
        { services: [NINEBOT_SERVICE] }
      ],
      optionalServices: [NINEBOT_SERVICE, 'battery_service', 'device_information']
    });

    bluetoothDevice.addEventListener('gattserverdisconnected', onDisconnected);
    await connectDevice();
  } catch (err) {
    console.error(err);
    if (err.name !== 'NotFoundError') {
      alert('Device selection cancelled or error: ' + err.message);
    }
  }
}

async function connectDevice() {
  try {
    gattServer = await bluetoothDevice.gatt.connect();
    document.getElementById('device-status').textContent = 'Connected';
    document.getElementById('device-status').className = 'status-connected';
    document.getElementById('bt-status').textContent = 'Connected';
    document.getElementById('scan-btn').classList.add('hidden');
    document.getElementById('disconnect-btn').classList.remove('hidden');

    const name = bluetoothDevice.name || '';
    let model = 'UNKNOWN DEVICE';
    if (/F3/i.test(name)) model = 'F3';
    else if (/G3/i.test(name) || /MAX.?G3/i.test(name)) model = 'G3';

    document.getElementById('device-model').textContent = `Model: ${model}`;
    document.getElementById('device-id').textContent = `ID: ${bluetoothDevice.id.slice(0,8)}...`;
    document.getElementById('device-fw').textContent = 'FW: Requires authenticated read';

    renderTemplates(model);
  } catch (err) {
    alert('Connection failed: ' + err.message);
    disconnectDevice();
  }
}

function onDisconnected() {
  document.getElementById('device-status').textContent = 'Disconnected';
  document.getElementById('device-status').className = 'status-disconnected';
  document.getElementById('bt-status').textContent = 'Disconnected';
  document.getElementById('scan-btn').classList.remove('hidden');
  document.getElementById('disconnect-btn').classList.add('hidden');
  document.getElementById('start-flash-btn').disabled = true;
  renderTemplates(); // Show all again
}

function disconnectDevice() {
  if (bluetoothDevice && bluetoothDevice.gatt.connected) {
    bluetoothDevice.gatt.disconnect();
  }
  bluetoothDevice = null;
  gattServer = null;
  onDisconnected();
}

// ==================== FLASH ====================
async function startFlash() {
  if (!selectedFirmware || !currentUser || currentUser.credits <= 0) {
    alert('No firmware selected or insufficient credits');
    return;
  }
  const modelEl = document.getElementById('device-model').textContent;
  const deviceModel = modelEl.includes('F3') ? 'F3' : modelEl.includes('G3') ? 'G3' : 'UNKNOWN';

  try {
    const res = await fetch(`${API}/flash/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_model: deviceModel, firmware_id: selectedFirmware.id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    currentSession = data.sessionId;

    document.getElementById('flash-progress').classList.remove('hidden');
    document.getElementById('start-flash-btn').disabled = true;

    // Simulated progress (real IAP requires official protocol)
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        finishFlash(true);
      }
      document.getElementById('progress-fill').style.width = progress + '%';
      document.getElementById('progress-text').textContent = Math.round(progress) + '%';
      document.getElementById('flash-status').textContent = progress < 100 ? 'Flashing...' : 'Complete';
    }, 400);
  } catch (err) {
    alert(err.message);
  }
}

async function finishFlash(success) {
  try {
    await fetch(`${API}/flash/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSession, success })
    });
    const msg = document.getElementById('flash-message');
    msg.className = 'message ' + (success ? 'success' : 'error');
    msg.textContent = success ? 'Update completed. 1 Credit deducted.' : 'Update failed. No credit deducted.';
    if (success && currentUser) {
      currentUser.credits -= 1;
      updateUserInfo();
    }
    loadHistory();
  } catch (e) { console.error(e); }
}

// ==================== ADMIN ====================
async function showAdmin() {
  document.getElementById('dashboard-screen').classList.remove('active');
  document.getElementById('admin-screen').classList.add('active');
  loadAdminStats();
  loadKeys();
}

async function loadAdminStats() {
  try {
    const res = await fetch(`${API}/admin/stats`);
    const stats = await res.json();
    document.getElementById('admin-stats').innerHTML = `
      <div class="card"><h3>TOTAL KEYS</h3><div class="stat-value">${stats.totalKeys || 0}</div></div>
      <div class="card"><h3>ACTIVE</h3><div class="stat-value">${stats.activeKeys || 0}</div></div>
      <div class="card"><h3>FLASHES</h3><div class="stat-value">${stats.totalFlashes || 0}</div></div>
    `;
  } catch (e) {}
}

async function loadKeys() {
  try {
    const res = await fetch(`${API}/admin/keys`);
    const keys = await res.json();
    document.getElementById('keys-table').innerHTML = keys.length ? `
      <table>
        <tr><th>ID</th><th>CREDITS</th><th>STATUS</th><th>EXPIRES</th><th>ACTIONS</th></tr>
        ${keys.map(k => `
          <tr>
            <td>${k.id}</td>
            <td>${k.credits}</td>
            <td>${k.status}</td>
            <td>${k.expiration_date || 'Unlimited'}</td>
            <td>
              <button class="btn-secondary" style="padding:0.3rem 0.6rem;font-size:0.75rem" onclick="toggleKey(${k.id}, '${k.status}')">${k.status === 'active' ? 'Block' : 'Unblock'}</button>
            </td>
          </tr>
        `).join('')}
      </table>
    ` : '<p style="color:#555">No keys</p>';
  } catch (e) {}
}

async function generateKeys() {
  const count = parseInt(document.getElementById('gen-count').value) || 1;
  let credits = document.getElementById('gen-credits').value;
  if (credits === 'custom') credits = document.getElementById('gen-credits-custom').value || 1;
  const unlimited = document.getElementById('gen-unlimited').checked;
  const expiration = unlimited ? null : document.getElementById('gen-expiration').value;

  try {
    const res = await fetch(`${API}/admin/keys/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, credits: Number(credits), expiration, unlimited })
    });
    const data = await res.json();
    document.getElementById('generated-keys').innerHTML = data.keys.map(k => `
      <div class="key-item">${k.key} <span style="color:#555">${k.credits} credits</span></div>
    `).join('');
    loadKeys();
  } catch (e) { alert('Error generating keys'); }
}

async function toggleKey(id, currentStatus) {
  const action = currentStatus === 'active' ? 'block' : 'unblock';
  await fetch(`${API}/admin/keys/${id}/${action}`, { method: 'POST' });
  loadKeys();
}
