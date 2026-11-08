const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'abis.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    access_key_hash TEXT NOT NULL UNIQUE,
    credits INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'blocked', 'expired')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expiration_date DATETIME,
    is_admin INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS firmware (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    model TEXT NOT NULL CHECK(model IN ('F3', 'G3')),
    version TEXT NOT NULL,
    file_reference TEXT,
    integrity_hash TEXT,
    compatibility_status TEXT NOT NULL DEFAULT 'pending' CHECK(compatibility_status IN ('verified', 'pending', 'blocked')),
    description TEXT,
    file_size INTEGER,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS flash_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    device_model TEXT,
    firmware_id INTEGER,
    firmware_name TEXT,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    completion_time DATETIME,
    result TEXT CHECK(result IN ('success', 'failed', 'aborted', 'pending')),
    credit_deducted INTEGER DEFAULT 0,
    details TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS admin_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER,
    action TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    details TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_users_hash ON users(access_key_hash);
  CREATE INDEX IF NOT EXISTS idx_flash_user ON flash_history(user_id);
`);

console.log('Database initialized at', dbPath);

// Create initial admin if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE is_admin = 1').get();
if (!adminExists) {
  const adminKey = process.env.ADMIN_KEY || 'ADMIN-INITIAL-KEY-CHANGE-ME';
  const hash = bcrypt.hashSync(adminKey, 12);
  db.prepare(`
    INSERT INTO users (access_key_hash, credits, status, is_admin, expiration_date)
    VALUES (?, 999999, 'active', 1, NULL)
  `).run(hash);
  console.log('Initial admin created. Key:', adminKey);
  console.log('IMPORTANT: Change the admin key after first login!');
}

module.exports = db;