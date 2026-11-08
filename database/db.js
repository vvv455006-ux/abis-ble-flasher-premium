/**
 * Lightweight JSON file database (no native deps).
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'abis.json');

function defaultData() {
  return {
    users: [],
    firmware: [],
    flash_history: [],
    admin_logs: [],
    _seq: { users: 0, firmware: 0, flash_history: 0, admin_logs: 0 }
  };
}

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const data = defaultData();
    save(data);
    return data;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function nextId(data, table) {
  data._seq[table] = (data._seq[table] || 0) + 1;
  return data._seq[table];
}

const db = {
  prepare(sql) {
    const s = sql.trim().toLowerCase();

    if (s.includes('select * from users where id = ?')) {
      return { get(id) { return load().users.find(u => u.id === Number(id)) || null; } };
    }
    if (s.includes('select * from users where status = ?')) {
      return { all(status) { return load().users.filter(u => u.status === status); } };
    }
    if (s.includes('select id from users where is_admin = 1')) {
      return { get() { return load().users.find(u => u.is_admin === 1) || null; } };
    }
    if (s.includes('insert into users') && s.includes('is_admin')) {
      return {
        run(hash, credits, status, is_admin, expiration_date) {
          const data = load();
          const id = nextId(data, 'users');
          data.users.push({
            id, access_key_hash: hash, credits: Number(credits), status: status || 'active',
            created_at: new Date().toISOString(), expiration_date: expiration_date || null, is_admin: is_admin ? 1 : 0
          });
          save(data);
          return { lastInsertRowid: id, changes: 1 };
        }
      };
    }
    if (s.includes('insert into users') && !s.includes('is_admin')) {
      return {
        run(hash, credits, expiration_date) {
          const data = load();
          const id = nextId(data, 'users');
          data.users.push({
            id, access_key_hash: hash, credits: Number(credits), status: 'active',
            created_at: new Date().toISOString(), expiration_date: expiration_date || null, is_admin: 0
          });
          save(data);
          return { lastInsertRowid: id, changes: 1 };
        }
      };
    }
    if (s.includes('update users set status = ? where id = ? and is_admin = 0')) {
      return {
        run(status, id) {
          const data = load();
          const u = data.users.find(x => x.id === Number(id) && !x.is_admin);
          if (!u) return { changes: 0 };
          u.status = status; save(data); return { changes: 1 };
        }
      };
    }
    if (s.includes('update users set status = ? where id = ?')) {
      return {
        run(status, id) {
          const data = load();
          const u = data.users.find(x => x.id === Number(id));
          if (!u) return { changes: 0 };
          u.status = status; save(data); return { changes: 1 };
        }
      };
    }
    if (s.includes('update users set credits = credits - 1')) {
      return {
        run(id) {
          const data = load();
          const u = data.users.find(x => x.id === Number(id));
          if (!u || u.credits <= 0) return { changes: 0 };
          u.credits -= 1; save(data); return { changes: 1 };
        }
      };
    }
    if (s.includes('update users set credits = ? where id = ?')) {
      return {
        run(credits, id) {
          const data = load();
          const u = data.users.find(x => x.id === Number(id));
          if (!u) return { changes: 0 };
          u.credits = Number(credits); save(data); return { changes: 1 };
        }
      };
    }
    if (s.includes('delete from users where id = ? and is_admin = 0')) {
      return {
        run(id) {
          const data = load();
          const before = data.users.length;
          data.users = data.users.filter(x => !(x.id === Number(id) && !x.is_admin));
          save(data);
          return { changes: before - data.users.length };
        }
      };
    }
    if (s.includes('select count(*) as c from users where is_admin = 0') && s.includes("status = 'active'")) {
      return { get() { return { c: load().users.filter(u => !u.is_admin && u.status === 'active').length }; } };
    }
    if (s.includes('select count(*) as c from users where is_admin = 0') && s.includes("status = 'blocked'")) {
      return { get() { return { c: load().users.filter(u => !u.is_admin && u.status === 'blocked').length }; } };
    }
    if (s.includes('select count(*) as c from users where is_admin = 0')) {
      return { get() { return { c: load().users.filter(u => !u.is_admin).length }; } };
    }
    if (s.includes('select coalesce(sum(credits),0) as s from users where is_admin = 0')) {
      return { get() { return { s: load().users.filter(u => !u.is_admin).reduce((a, u) => a + (u.credits || 0), 0) }; } };
    }
    if (s.includes('select count(*) as c from flash_history where credit_deducted = 1')) {
      return { get() { return { c: load().flash_history.filter(h => h.credit_deducted === 1).length }; } };
    }
    if (s.includes("select count(*) as c from flash_history where result = 'success'")) {
      return { get() { return { c: load().flash_history.filter(h => h.result === 'success').length }; } };
    }
    if (s.includes("select count(*) as c from flash_history where result = 'failed'")) {
      return { get() { return { c: load().flash_history.filter(h => h.result === 'failed').length }; } };
    }
    if (s.includes('select id, credits, status, created_at, expiration_date') && s.includes('from users where is_admin = 0')) {
      return {
        all() {
          const data = load();
          return data.users.filter(u => !u.is_admin).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .map(u => ({ ...u, used_credits: data.flash_history.filter(h => h.user_id === u.id && h.credit_deducted === 1).length }));
        }
      };
    }
    if (s.includes('select credits from users where id = ? and is_admin = 0')) {
      return { get(id) { const u = load().users.find(x => x.id === Number(id) && !x.is_admin); return u ? { credits: u.credits } : null; } };
    }
    if (s.includes('select credits from users where id = ?')) {
      return { get(id) { const u = load().users.find(x => x.id === Number(id)); return u ? { credits: u.credits } : null; } };
    }
    if (s.includes('insert into admin_logs')) {
      return {
        run(adminId, action, details) {
          const data = load();
          const id = nextId(data, 'admin_logs');
          data.admin_logs.push({ id, admin_id: adminId, action, timestamp: new Date().toISOString(), details: typeof details === 'string' ? details : JSON.stringify(details || {}) });
          save(data);
          return { lastInsertRowid: id, changes: 1 };
        }
      };
    }
    if (s.includes('select * from admin_logs')) {
      return { all() { return load().admin_logs.slice().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 200); } };
    }
    if (s.includes('insert into firmware')) {
      return {
        run(name, model, version, file_reference, integrity_hash, compatibility_status, description, file_size) {
          const data = load();
          const id = nextId(data, 'firmware');
          data.firmware.push({ id, name, model, version, file_reference, integrity_hash, compatibility_status: compatibility_status || 'pending', description: description || '', file_size: file_size || 0, uploaded_at: new Date().toISOString() });
          save(data);
          return { lastInsertRowid: id, changes: 1 };
        }
      };
    }
    if (s.includes('from firmware where compatibility_status = ?') || s.includes("compatibility_status = 'verified'")) {
      return {
        all() { return load().firmware.filter(f => f.compatibility_status === 'verified'); },
        get(id, status) { return load().firmware.find(f => f.id === Number(id) && f.compatibility_status === (status || 'verified')) || null; }
      };
    }
    if (s.includes('select * from firmware where id = ?')) {
      return { get(id, status) { return load().firmware.find(f => f.id === Number(id) && f.compatibility_status === status) || null; } };
    }
    if (s.includes('insert into flash_history')) {
      return {
        run(user_id, device_model, firmware_id, firmware_name, result) {
          const data = load();
          const id = nextId(data, 'flash_history');
          data.flash_history.push({ id, user_id: Number(user_id), device_model, firmware_id: firmware_id ? Number(firmware_id) : null, firmware_name, start_time: new Date().toISOString(), completion_time: null, result: result || 'pending', credit_deducted: 0, details: null });
          save(data);
          return { lastInsertRowid: id, changes: 1 };
        }
      };
    }
    if (s.includes('select * from flash_history where id = ? and user_id = ?')) {
      return { get(id, userId) { return load().flash_history.find(h => h.id === Number(id) && h.user_id === Number(userId)) || null; } };
    }
    if (s.includes('update flash_history')) {
      return {
        run(result, credit_deducted, details, id) {
          const data = load();
          const h = data.flash_history.find(x => x.id === Number(id));
          if (!h) return { changes: 0 };
          h.result = result; h.completion_time = new Date().toISOString(); h.credit_deducted = credit_deducted; h.details = details;
          save(data);
          return { changes: 1 };
        }
      };
    }
    if (s.includes('from flash_history where user_id = ?')) {
      return {
        all(userId) {
          return load().flash_history.filter(h => h.user_id === Number(userId))
            .sort((a, b) => new Date(b.start_time) - new Date(a.start_time)).slice(0, 100);
        }
      };
    }
    console.warn('[db] Unhandled SQL:', sql);
    return { get() { return null; }, all() { return []; }, run() { return { changes: 0, lastInsertRowid: 0 }; } };
  }
};

(function bootstrap() {
  const data = load();
  if (!data.users.some(u => u.is_admin === 1)) {
    const adminKey = process.env.ADMIN_KEY || 'ADMIN-INITIAL-KEY-CHANGE-ME';
    const hash = bcrypt.hashSync(adminKey, 12);
    const id = nextId(data, 'users');
    data.users.push({ id, access_key_hash: hash, credits: 999999, status: 'active', created_at: new Date().toISOString(), expiration_date: null, is_admin: 1 });
    save(data);
    console.log('Initial admin created. Key:', adminKey);
    console.log('IMPORTANT: Change the admin key after first login!');
  }
})();

module.exports = db;
console.log('JSON database ready at', DB_PATH);
