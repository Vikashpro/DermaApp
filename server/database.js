import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const defaultDatabasePath = resolve('data', 'clinic.sqlite');

export function openDatabase(filename = defaultDatabasePath) {
  mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

export function backupDatabaseOnStart(filename = defaultDatabasePath, backupDirectory = resolve('backups')) {
  mkdirSync(backupDirectory, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const backupPath = resolve(backupDirectory, `clinic-backup-${today}.sqlite`);

  if (existsSync(backupPath)) {
    return { created: false, backupPath };
  }

  copyFileSync(filename, backupPath);
  return { created: true, backupPath };
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cnic TEXT UNIQUE,
      contact TEXT,
      age INTEGER,
      gender TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_patients_contact ON patients(contact);

    CREATE TABLE IF NOT EXISTS doctors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS procedures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS treatments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      doctor_id INTEGER,
      diagnosis TEXT NOT NULL,
      procedure TEXT NOT NULL,
      total_sessions INTEGER NOT NULL,
      charges REAL NOT NULL DEFAULT 0,
      next_appointment_date TEXT,
      remarks TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT CURRENT_DATE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id),
      FOREIGN KEY (doctor_id) REFERENCES doctors(id)
    );

    CREATE INDEX IF NOT EXISTS idx_treatments_patient_status ON treatments(patient_id, status);

    CREATE TABLE IF NOT EXISTS treatment_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      treatment_id INTEGER NOT NULL,
      doctor_id INTEGER,
      session_number INTEGER NOT NULL,
      visit_date TEXT NOT NULL DEFAULT CURRENT_DATE,
      next_appointment_date TEXT,
      charges REAL NOT NULL DEFAULT 0,
      remarks TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (treatment_id) REFERENCES treatments(id),
      FOREIGN KEY (doctor_id) REFERENCES doctors(id),
      UNIQUE (treatment_id, session_number)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_next_date ON treatment_sessions(next_appointment_date);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS clinic_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      clinic_name TEXT NOT NULL DEFAULT 'Dermatology Clinic',
      contact TEXT,
      email TEXT,
      address TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  addColumnIfMissing(db, 'treatments', 'next_appointment_date', 'TEXT');
  addColumnIfMissing(db, 'treatment_sessions', 'doctor_id', 'INTEGER REFERENCES doctors(id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_treatments_next_date ON treatments(next_appointment_date)');
  db.prepare(`
    INSERT OR IGNORE INTO clinic_settings (id, clinic_name)
    VALUES (1, 'Dermatology Clinic')
  `).run();
  seedProceduresFromTreatments(db);
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function seedProceduresFromTreatments(db) {
  const existing = db
    .prepare(`
      SELECT DISTINCT procedure AS name
      FROM treatments
      WHERE procedure IS NOT NULL AND TRIM(procedure) != ''
    `)
    .all();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO procedures (name, name_key)
    VALUES (?, ?)
  `);

  for (const item of existing) {
    const name = String(item.name).trim();
    insert.run(name, name.toLowerCase().replace(/\s+/g, ' '));
  }
}
