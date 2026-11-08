require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const db = require('../database/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // for simplicity in this app
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts.' }
});

// Session
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24h
    sameSite: 'lax'
  }
}));

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend/public')));

// Middleware
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.status !== 'active') {
    req.session.destroy();
    return res.status(401).json({ error: 'Session invalid or user blocked' });
  }
  if (user.expiration_date && new Date(user.expiration_date) < new Date()) {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run('expired', user.id);
    req.session.destroy();
    return res.status(401).json({ error: 'Key expired' });
  }
  if (user.credits <= 0 && !user.is_admin) {
    return res.status(403).json({ error: 'No credits remaining' });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Auth required' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  req.user = user;
  next();
}

function logAdmin(adminId, action, details) {
  db.prepare('INSERT INTO admin_logs (admin_id, action, details) VALUES (?, ?, ?)').run(adminId, action, JSON.stringify(details || {}));
}

// ==================== AUTH ROUTES ====================
app.post('/api/auth/login', authLimiter, (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ error: 'Access key required' });

  const users = db.prepare('SELECT * FROM users WHERE status = ?').all('active');
  let matched = null;
  for (const user of users) {
    if (bcrypt.compareSync(key, user.access_key_hash)) {
      matched = user;
      break;
    }
  }

  if (!matched) {
    return res.status(401).json({ error: 'Invalid access key' });
  }

  if (matched.expiration_date && new Date(matched.expiration_date) < new Date()) {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run('expired', matched.id);
    return res.status(401).json({ error: 'Access key expired' });
  }

  if (matched.credits <= 0 && !matched.is_admin) {
    return res.status(403).json({ error: 'No credits remaining on this key' });
  }

  req.session.userId = matched.id;
  req.session.isAdmin = !!matched.is_admin;

  res.json({
    success: true,
    isAdmin: !!matched.is_admin,
    credits: matched.credits,
    userId: matched.id
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    credits: req.user.credits,
    isAdmin: !!req.user.is_admin,
    status: req.user.status,
    expiration: req.user.expiration_date
  });
});

// ==================== ADMIN ROUTES ====================
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const totalKeys = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_admin = 0').get().c;
  const activeKeys = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_admin = 0 AND status = 'active'").get().c;
  const blockedKeys = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_admin = 0 AND status = 'blocked'").get().c;
  const totalCredits = db.prepare('SELECT COALESCE(SUM(credits),0) as s FROM users WHERE is_admin = 0').get().s;
  const totalUsed = db.prepare('SELECT COUNT(*) as c FROM flash_history WHERE credit_deducted = 1').get().c;
  const successFlash = db.prepare("SELECT COUNT(*) as c FROM flash_history WHERE result = 'success'").get().c;
  const failedFlash = db.prepare("SELECT COUNT(*) as c FROM flash_history WHERE result = 'failed'").get().c;

  res.json({
    totalKeys, activeKeys, blockedKeys, totalCredits, totalUsedCredits: totalUsed,
    successfulFlashes: successFlash, failedFlashes: failedFlash
  });
});

app.get('/api/admin/keys', requireAdmin, (req, res) => {
  const keys = db.prepare(`
    SELECT id, credits, status, created_at, expiration_date,
           (SELECT COUNT(*) FROM flash_history WHERE user_id = users.id AND credit_deducted = 1) as used_credits
    FROM users WHERE is_admin = 0 ORDER BY created_at DESC
  `).all();
  res.json(keys);
});

app.post('/api/admin/keys/generate', requireAdmin, (req, res) => {
  const { count = 1, credits = 1, expiration = null, unlimited = false } = req.body;
  if (count < 1 || count > 100) return res.status(400).json({ error: 'Count 1-100' });
  if (credits < 0) return res.status(400).json({ error: 'Invalid credits' });

  const generated = [];
  const insert = db.prepare(`
    INSERT INTO users (access_key_hash, credits, status, expiration_date)
    VALUES (?, ?, 'active', ?)
  `);

  for (let i = 0; i < count; i++) {
    const rawKey = 'ABIS-' + crypto.randomBytes(16).toString('hex').toUpperCase();
    const hash = bcrypt.hashSync(rawKey, 12);
    const exp = unlimited ? null : (expiration || null);
    const result = insert.run(hash, credits, exp);
    generated.push({ id: result.lastInsertRowid, key: rawKey, credits, expiration: exp });
  }

  logAdmin(req.user.id, 'GENERATE_KEYS', { count, credits, expiration, unlimited, ids: generated.map(g => g.id) });
  res.json({ success: true, keys: generated });
});

app.post('/api/admin/keys/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body; // active, blocked
  if (!['active', 'blocked'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE users SET status = ? WHERE id = ? AND is_admin = 0').run(status, req.params.id);
  logAdmin(req.user.id, 'UPDATE_KEY_STATUS', { keyId: req.params.id, status });
  res.json({ success: true });
});

app.post('/api/admin/keys/:id/credits', requireAdmin, (req, res) => {
  const { amount, action } = req.body; // action: add or subtract
  const key = db.prepare('SELECT credits FROM users WHERE id = ? AND is_admin = 0').get(req.params.id);
  if (!key) return res.status(404).json({ error: 'Key not found' });

  let newCredits = key.credits;
  if (action === 'add') newCredits += Math.abs(amount);
  else if (action === 'subtract') newCredits = Math.max(0, newCredits - Math.abs(amount));
  else return res.status(400).json({ error: 'Invalid action' });

  db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(newCredits, req.params.id);
  logAdmin(req.user.id, 'ADJUST_CREDITS', { keyId: req.params.id, action, amount, newCredits });
  res.json({ success: true, credits: newCredits });
});

app.delete('/api/admin/keys/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ? AND is_admin = 0').run(req.params.id);
  logAdmin(req.user.id, 'DELETE_KEY', { keyId: req.params.id });
  res.json({ success: true });
});

app.get('/api/admin/logs', requireAdmin, (req, res) => {
  const logs = db.prepare('SELECT * FROM admin_logs ORDER BY timestamp DESC LIMIT 200').all();
  res.json(logs);
});

// Firmware management (admin)
const upload = multer({ dest: path.join(__dirname, '../firmware/uploads/') });
app.post('/api/admin/firmware', requireAdmin, upload.single('file'), (req, res) => {
  // In production: verify file integrity, model compatibility, etc.
  // Here we store reference only if provided
  const { name, model, version, description, compatibility_status = 'pending' } = req.body;
  if (!['F3', 'G3'].includes(model)) return res.status(400).json({ error: 'Model must be F3 or G3' });

  let hash = null;
  let fileRef = null;
  let size = 0;
  if (req.file) {
    const filePath = req.file.path;
    const fileBuffer = fs.readFileSync(filePath);
    hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    fileRef = req.file.filename;
    size = req.file.size;
  }

  const result = db.prepare(`
    INSERT INTO firmware (name, model, version, file_reference, integrity_hash, compatibility_status, description, file_size)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, model, version, fileRef, hash, compatibility_status, description, size);

  logAdmin(req.user.id, 'ADD_FIRMWARE', { id: result.lastInsertRowid, name, model, version });
  res.json({ success: true, id: result.lastInsertRowid });
});

// ==================== USER ROUTES ====================
app.get('/api/firmware', requireAuth, (req, res) => {
  const firmwares = db.prepare(`
    SELECT id, name, model, version, description, file_size, compatibility_status, integrity_hash
    FROM firmware WHERE compatibility_status = 'verified'
  `).all();
  res.json(firmwares);
});

app.get('/api/history', requireAuth, (req, res) => {
  const history = db.prepare(`
    SELECT id, device_model, firmware_name, start_time, completion_time, result, credit_deducted, details
    FROM flash_history WHERE user_id = ? ORDER BY start_time DESC LIMIT 100
  `).all(req.user.id);
  res.json(history);
});

// Flash session start (no credit yet)
app.post('/api/flash/start', requireAuth, (req, res) => {
  if (req.user.credits <= 0) return res.status(403).json({ error: 'Insufficient credits' });

  const { device_model, firmware_id } = req.body;
  const fw = db.prepare('SELECT * FROM firmware WHERE id = ? AND compatibility_status = ?').get(firmware_id, 'verified');
  if (!fw) return res.status(400).json({ error: 'Invalid or unverified firmware' });

  // Model match check
  if (fw.model !== device_model && device_model !== 'UNKNOWN') {
    return res.status(400).json({ error: 'Firmware not compatible with detected device model' });
  }

  const result = db.prepare(`
    INSERT INTO flash_history (user_id, device_model, firmware_id, firmware_name, result)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(req.user.id, device_model, firmware_id, fw.name);

  res.json({ success: true, sessionId: result.lastInsertRowid, firmware: fw });
});

// Complete flash - atomic credit deduction ONLY on verified success
app.post('/api/flash/complete', requireAuth, (req, res) => {
  const { sessionId, success, details } = req.body;
  const session = db.prepare('SELECT * FROM flash_history WHERE id = ? AND user_id = ?').get(sessionId, req.user.id);
  if (!session || session.result !== 'pending') {
    return res.status(400).json({ error: 'Invalid or already completed session' });
  }

  const resultStatus = success ? 'success' : 'failed';
  let creditDeducted = 0;

  if (success) {
    // Atomic deduction
    const update = db.prepare('UPDATE users SET credits = credits - 1 WHERE id = ? AND credits > 0').run(req.user.id);
    if (update.changes === 1) {
      creditDeducted = 1;
    } else {
      return res.status(403).json({ error: 'Credit deduction failed - no credits left' });
    }
  }

  db.prepare(`
    UPDATE flash_history 
    SET result = ?, completion_time = CURRENT_TIMESTAMP, credit_deducted = ?, details = ?
    WHERE id = ?
  `).run(resultStatus, creditDeducted, JSON.stringify(details || {}), sessionId);

  const updatedUser = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
  res.json({ success: true, creditDeducted, remainingCredits: updatedUser.credits, result: resultStatus });
});

// Health
app.get('/api/health', (req, res) => res.json({ status: 'ok', name: 'ABIS BLE FLASHER' }));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/public/index.html'));
});

app.listen(PORT, () => {
  console.log(`ABIS BLE FLASHER running on http://localhost:${PORT}`);
  console.log('Ensure HTTPS in production for Web Bluetooth');
});