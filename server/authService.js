import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_DAYS = 7;

function cleanText(value) {
  const text = String(value ?? '').trim();
  return text.length ? text : null;
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash ?? '').split(':');
  if (!salt || !hash) return false;
  const actual = Buffer.from(hashPassword(password, salt).split(':')[1], 'hex');
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function ensureDefaultAdmin(db) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (row.count > 0) return;
  db.prepare(`
    INSERT INTO users (name, username, password_hash, role)
    VALUES (?, ?, ?, ?)
  `).run('Administrator', 'admin', hashPassword('admin123'), 'admin');
}

export function login(db, { username, password }) {
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(cleanText(username));
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new Error('Invalid username or password.');
  }

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO user_sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expiresAt);
  return { token, user: publicUser(user) };
}

export function logout(db, token) {
  if (token) db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
}

export function getUserByToken(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.*
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.active = 1
  `).get(token);
  return row ? publicUser(row) : null;
}

export function listUsers(db) {
  return db.prepare(`
    SELECT id, name, username, role, active, created_at, updated_at
    FROM users
    ORDER BY id ASC
  `).all();
}

export function saveUser(db, input) {
  const id = Number(input.id || 0);
  const name = cleanText(input.name);
  const username = cleanText(input.username);
  const role = cleanText(input.role) || 'staff';
  const active = input.active === false || input.active === 0 ? 0 : 1;
  const password = cleanText(input.password);

  if (!name) throw new Error('Name is required.');
  if (!username) throw new Error('Username is required.');
  if (!['admin', 'staff'].includes(role)) throw new Error('Invalid role.');

  if (id) {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) throw new Error('User not found.');
    if (password) {
      db.prepare(`
        UPDATE users
        SET name = ?, username = ?, password_hash = ?, role = ?, active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, username, hashPassword(password), role, active, id);
    } else {
      db.prepare(`
        UPDATE users
        SET name = ?, username = ?, role = ?, active = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, username, role, active, id);
    }
    return db.prepare('SELECT id, name, username, role, active, created_at, updated_at FROM users WHERE id = ?').get(id);
  }

  if (!password) throw new Error('Password is required for new users.');
  const result = db.prepare(`
    INSERT INTO users (name, username, password_hash, role, active)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, username, hashPassword(password), role, active);
  return db.prepare('SELECT id, name, username, role, active, created_at, updated_at FROM users WHERE id = ?').get(result.lastInsertRowid);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active
  };
}
