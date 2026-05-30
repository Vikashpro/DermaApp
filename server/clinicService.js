function cleanText(value) {
  const text = String(value ?? '').trim();
  return text.length ? text : null;
}

function cleanNumber(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function doctorKey(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function catalogKey(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cleanStatus(value) {
  const status = cleanText(value);
  return status === 'active' || status === 'completed' ? status : 'all';
}

function addDateRangeClause(clauses, params, column, from, to) {
  const fromDate = cleanText(from);
  const toDate = cleanText(to);
  if (fromDate && toDate) {
    clauses.push(`${column} BETWEEN ? AND ?`);
    params.push(fromDate, toDate);
  } else if (fromDate) {
    clauses.push(`${column} >= ?`);
    params.push(fromDate);
  } else if (toDate) {
    clauses.push(`${column} <= ?`);
    params.push(toDate);
  }
}

function getPatientSummary(db, patientId) {
  const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  return {
    patient,
    activeTreatment: getActiveTreatment(db, patientId)
  };
}

export function lookupPatient(db, { cnic, contact }) {
  const cnicValue = cleanText(cnic);
  const contactValue = cleanText(contact);
  let patient = null;
  let matchedBy = null;

  if (cnicValue) {
    patient = db.prepare('SELECT * FROM patients WHERE cnic = ?').get(cnicValue) ?? null;
    matchedBy = patient ? 'cnic' : null;
  }

  if (!patient && !cnicValue && contactValue) {
    patient = db
      .prepare('SELECT * FROM patients WHERE contact = ? ORDER BY updated_at DESC, id DESC LIMIT 1')
      .get(contactValue) ?? null;
    matchedBy = patient ? 'contact' : null;
  }

  return {
    matched: Boolean(patient),
    matchedBy,
    patient,
    activeTreatment: patient ? getActiveTreatment(db, patient.id) : null
  };
}

export function listDoctors(db, search = '') {
  const term = `%${doctorKey(search)}%`;
  return db
    .prepare('SELECT id, name FROM doctors WHERE name_key LIKE ? ORDER BY name LIMIT 100')
    .all(term);
}

export function listProcedures(db, search = '') {
  const term = `%${catalogKey(search)}%`;
  return db
    .prepare('SELECT id, name FROM procedures WHERE name_key LIKE ? ORDER BY name LIMIT 50')
    .all(term);
}

export function createProcedure(db, name) {
  const procedureName = cleanText(name);
  if (!procedureName) throw new Error('Procedure name is required.');

  const key = catalogKey(procedureName);
  const existing = db.prepare('SELECT id, name FROM procedures WHERE name_key = ?').get(key);
  if (existing) return { procedure: existing, created: false };

  const result = db
    .prepare('INSERT INTO procedures (name, name_key) VALUES (?, ?)')
    .run(procedureName, key);

  return {
    procedure: {
      id: result.lastInsertRowid,
      name: procedureName
    },
    created: true
  };
}

export function saveProcedure(db, { id, name } = {}) {
  const procedureId = Number(id || 0);
  const procedureName = cleanText(name);
  if (!procedureName) throw new Error('Procedure name is required.');

  if (!procedureId) return createProcedure(db, procedureName);

  const existing = db.prepare('SELECT id FROM procedures WHERE id = ?').get(procedureId);
  if (!existing) throw new Error('Procedure not found.');

  const key = catalogKey(procedureName);
  const duplicate = db.prepare('SELECT id FROM procedures WHERE name_key = ? AND id != ?').get(key, procedureId);
  if (duplicate) throw new Error('Another procedure already has this name.');

  db.prepare(`
    UPDATE procedures
    SET name = ?, name_key = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(procedureName, key, procedureId);

  return { procedure: db.prepare('SELECT id, name FROM procedures WHERE id = ?').get(procedureId), created: false };
}

export function deleteProcedure(db, id) {
  const procedureId = Number(id || 0);
  if (!procedureId) throw new Error('Procedure is required.');
  const procedure = db.prepare('SELECT * FROM procedures WHERE id = ?').get(procedureId);
  if (!procedure) throw new Error('Procedure not found.');

  const used = db.prepare('SELECT COUNT(*) AS count FROM treatments WHERE procedure = ?').get(procedure.name);
  if (used.count > 0) throw new Error('Procedure is used in treatments and cannot be deleted.');

  db.prepare('DELETE FROM procedures WHERE id = ?').run(procedureId);
  return { deleted: true };
}

export function saveDoctor(db, { id, name } = {}) {
  const doctorId = Number(id || 0);
  const doctorName = cleanText(name);
  if (!doctorName) throw new Error('Doctor name is required.');

  if (!doctorId) {
    const id = upsertDoctor(db, doctorName);
    return { doctor: db.prepare('SELECT id, name FROM doctors WHERE id = ?').get(id), created: true };
  }

  const existing = db.prepare('SELECT id FROM doctors WHERE id = ?').get(doctorId);
  if (!existing) throw new Error('Doctor not found.');

  const key = doctorKey(doctorName);
  const duplicate = db.prepare('SELECT id FROM doctors WHERE name_key = ? AND id != ?').get(key, doctorId);
  if (duplicate) throw new Error('Another doctor already has this name.');

  db.prepare(`
    UPDATE doctors
    SET name = ?, name_key = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(doctorName, key, doctorId);

  return { doctor: db.prepare('SELECT id, name FROM doctors WHERE id = ?').get(doctorId), created: false };
}

export function deleteDoctor(db, id) {
  const doctorId = Number(id || 0);
  if (!doctorId) throw new Error('Doctor is required.');
  const treatmentCount = db.prepare('SELECT COUNT(*) AS count FROM treatments WHERE doctor_id = ?').get(doctorId).count;
  const sessionCount = db.prepare('SELECT COUNT(*) AS count FROM treatment_sessions WHERE doctor_id = ?').get(doctorId).count;
  if (treatmentCount || sessionCount) throw new Error('Doctor is used in treatments or sessions and cannot be deleted.');
  const result = db.prepare('DELETE FROM doctors WHERE id = ?').run(doctorId);
  if (!result.changes) throw new Error('Doctor not found.');
  return { deleted: true };
}

export function getClinicSettings(db) {
  return db.prepare(`
    SELECT clinic_name, contact, email, address, updated_at
    FROM clinic_settings
    WHERE id = 1
  `).get();
}

export function saveClinicSettings(db, input = {}) {
  const clinicName = cleanText(input.clinicName ?? input.clinic_name);
  const contact = cleanText(input.contact);
  const email = cleanText(input.email);
  const address = cleanText(input.address);

  if (!clinicName) throw new Error('Clinic name is required.');

  db.prepare(`
    INSERT INTO clinic_settings (id, clinic_name, contact, email, address, updated_at)
    VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      clinic_name = excluded.clinic_name,
      contact = excluded.contact,
      email = excluded.email,
      address = excluded.address,
      updated_at = CURRENT_TIMESTAMP
  `).run(clinicName, contact, email, address);

  return getClinicSettings(db);
}

export function countAppointments(db, date) {
  const appointmentDate = cleanText(date);
  if (!appointmentDate) return { date: null, count: 0 };
  const row = db
    .prepare(`
      SELECT COUNT(*) AS count
      FROM treatments
      WHERE status = 'active' AND next_appointment_date = ?
    `)
    .get(appointmentDate);
  return { date: appointmentDate, count: row.count };
}

export function listAppointmentsByDate(db, date) {
  const appointmentDate = cleanText(date);
  if (!appointmentDate) return { date: null, count: 0, appointments: [] };

  const appointments = db
    .prepare(`
      SELECT
        t.id AS treatment_id,
        t.diagnosis,
        t.procedure,
        t.total_sessions,
        t.next_appointment_date,
        p.id AS patient_id,
        p.name AS patient_name,
        p.cnic,
        p.contact,
        COUNT(s.id) AS completed_sessions
      FROM treatments t
      JOIN patients p ON p.id = t.patient_id
      LEFT JOIN treatment_sessions s ON s.treatment_id = t.id
      WHERE t.status = 'active' AND t.next_appointment_date = ?
      GROUP BY t.id
      ORDER BY p.name ASC
    `)
    .all(appointmentDate)
    .map((appointment) => ({
      ...appointment,
      remaining_sessions: appointment.total_sessions - appointment.completed_sessions,
      next_session_number: appointment.completed_sessions + 1
    }));

  return {
    date: appointmentDate,
    count: appointments.length,
    appointments
  };
}

export function listAppointments(db, { from, to, search, mode } = {}) {
  const fromDate = cleanText(from);
  const toDate = cleanText(to);
  const searchText = cleanText(search);
  const listMode = cleanText(mode) || 'future';

  if (!fromDate) return { from: fromDate, to: toDate, mode: listMode, count: 0, appointments: [] };

  const params = [fromDate];
  const dateClause = listMode === 'today' || toDate
    ? 't.next_appointment_date BETWEEN ? AND ?'
    : 't.next_appointment_date >= ?';
  if (listMode === 'today' || toDate) {
    params.push(toDate || fromDate);
  }
  let searchClause = '';
  if (searchText) {
    searchClause = `
      AND (
        p.name LIKE ?
        OR p.cnic LIKE ?
        OR p.contact LIKE ?
        OR t.diagnosis LIKE ?
        OR t.procedure LIKE ?
      )
    `;
    const term = `%${searchText}%`;
    params.push(term, term, term, term, term);
  }

  const appointments = db
    .prepare(`
      SELECT
        t.id AS treatment_id,
        t.diagnosis,
        t.procedure,
        t.total_sessions,
        t.next_appointment_date,
        p.id AS patient_id,
        p.name AS patient_name,
        p.cnic,
        p.contact,
        COUNT(s.id) AS completed_sessions
      FROM treatments t
      JOIN patients p ON p.id = t.patient_id
      LEFT JOIN treatment_sessions s ON s.treatment_id = t.id
      WHERE t.status = 'active'
        AND t.next_appointment_date IS NOT NULL
        AND ${dateClause}
        ${searchClause}
      GROUP BY t.id
      HAVING completed_sessions < t.total_sessions
      ORDER BY t.next_appointment_date ASC, p.name ASC
    `)
    .all(...params)
    .map((appointment) => ({
      ...appointment,
      remaining_sessions: appointment.total_sessions - appointment.completed_sessions,
      next_session_number: appointment.completed_sessions + 1
    }));

  return {
    from: fromDate,
    to: toDate,
    mode: listMode,
    count: appointments.length,
    appointments
  };
}

export function updateAppointmentDate(db, { treatmentId, nextAppointmentDate }) {
  const id = Number(treatmentId);
  const appointmentDate = cleanText(nextAppointmentDate);
  if (!id) throw new Error('Treatment is required.');
  if (!appointmentDate) throw new Error('Next appointment date is required.');

  const treatment = db
    .prepare(`
      SELECT
        t.id,
        t.total_sessions,
        t.status,
        COUNT(s.id) AS completed_sessions
      FROM treatments t
      LEFT JOIN treatment_sessions s ON s.treatment_id = t.id
      WHERE t.id = ?
      GROUP BY t.id
    `)
    .get(id);

  if (!treatment || treatment.status !== 'active') throw new Error('Active treatment not found.');
  if (treatment.completed_sessions >= treatment.total_sessions) throw new Error('Treatment is already completed.');

  db.prepare(`
    UPDATE treatments
    SET next_appointment_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(appointmentDate, id);

  return db.prepare('SELECT id, next_appointment_date FROM treatments WHERE id = ?').get(id);
}

export function updatePatient(db, { id, name, cnic, contact, age, gender } = {}) {
  const patientId = Number(id || 0);
  const patientName = cleanText(name);
  const cnicValue = cleanText(cnic);
  const contactValue = cleanText(contact);
  const ageValue = cleanNumber(age);
  const genderValue = cleanText(gender);

  if (!patientId) throw new Error('Patient is required.');
  if (!patientName) throw new Error('Patient name is required.');
  if (!cnicValue && !contactValue) throw new Error('CNIC or contact number is required.');

  const existing = db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId);
  if (!existing) throw new Error('Patient not found.');
  if (cnicValue) {
    const duplicate = db.prepare('SELECT id FROM patients WHERE cnic = ? AND id != ?').get(cnicValue, patientId);
    if (duplicate) throw new Error('Another patient already has this CNIC.');
  }

  db.prepare(`
    UPDATE patients
    SET name = ?, cnic = ?, contact = ?, age = ?, gender = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(patientName, cnicValue, contactValue, ageValue, genderValue, patientId);

  return getPatientSummary(db, patientId);
}

export function deletePatient(db, id) {
  const patientId = Number(id || 0);
  if (!patientId) throw new Error('Patient is required.');
  const treatmentCount = db.prepare('SELECT COUNT(*) AS count FROM treatments WHERE patient_id = ?').get(patientId).count;
  if (treatmentCount > 0) throw new Error('Patient has treatment records and cannot be deleted.');
  const result = db.prepare('DELETE FROM patients WHERE id = ?').run(patientId);
  if (!result.changes) throw new Error('Patient not found.');
  return { deleted: true };
}

export function updateTreatment(db, input = {}) {
  const treatmentId = Number(input.id || input.treatmentId || 0);
  const diagnosis = cleanText(input.diagnosis);
  const procedure = cleanText(input.procedure);
  const totalSessions = Math.trunc(cleanNumber(input.totalSessions ?? input.total_sessions, 1));
  const charges = cleanNumber(input.charges, 0);
  const doctorName = cleanText(input.doctorName ?? input.doctor_name);
  const nextAppointmentDate = cleanText(input.nextAppointmentDate ?? input.next_appointment_date);
  const remarks = cleanText(input.remarks);
  const status = cleanText(input.status) || 'active';

  if (!treatmentId) throw new Error('Treatment is required.');
  if (!diagnosis) throw new Error('Diagnosis is required.');
  if (!procedure) throw new Error('Procedure is required.');
  if (!Number.isInteger(totalSessions) || totalSessions < 1) throw new Error('Number of sessions must be at least 1.');
  if (charges < 0) throw new Error('Charges cannot be negative.');
  if (!['active', 'completed'].includes(status)) throw new Error('Invalid treatment status.');

  const current = db.prepare(`
    SELECT t.*, COUNT(s.id) AS completed_sessions
    FROM treatments t
    LEFT JOIN treatment_sessions s ON s.treatment_id = t.id
    WHERE t.id = ?
    GROUP BY t.id
  `).get(treatmentId);
  if (!current) throw new Error('Treatment not found.');
  if (totalSessions < current.completed_sessions) {
    throw new Error('Total sessions cannot be less than completed sessions.');
  }

  const doctorId = doctorName ? upsertDoctor(db, doctorName) : null;
  db.prepare(`
    UPDATE treatments
    SET doctor_id = ?,
        diagnosis = ?,
        procedure = ?,
        total_sessions = ?,
        charges = ?,
        next_appointment_date = ?,
        remarks = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(doctorId, diagnosis, procedure, totalSessions, charges, nextAppointmentDate, remarks, status, treatmentId);

  if (status === 'completed') {
    db.prepare('UPDATE treatments SET next_appointment_date = NULL WHERE id = ?').run(treatmentId);
  }

  return getPatientSummary(db, current.patient_id);
}

export function deleteTreatment(db, id) {
  const treatmentId = Number(id || 0);
  if (!treatmentId) throw new Error('Treatment is required.');
  const treatment = db.prepare('SELECT patient_id FROM treatments WHERE id = ?').get(treatmentId);
  if (!treatment) throw new Error('Treatment not found.');

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM treatment_sessions WHERE treatment_id = ?').run(treatmentId);
    db.prepare('DELETE FROM treatments WHERE id = ?').run(treatmentId);
    const summary = getPatientSummary(db, treatment.patient_id);
    db.exec('COMMIT');
    return summary;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function updateSession(db, input = {}) {
  const sessionId = Number(input.id || input.sessionId || 0);
  const visitDate = cleanText(input.visitDate ?? input.visit_date);
  const nextAppointmentDate = cleanText(input.nextAppointmentDate ?? input.next_appointment_date);
  const charges = cleanNumber(input.charges, 0);
  const remarks = cleanText(input.remarks);
  const doctorName = cleanText(input.doctorName ?? input.doctor_name);

  if (!sessionId) throw new Error('Session is required.');
  if (!visitDate) throw new Error('Visit date is required.');
  if (charges < 0) throw new Error('Charges cannot be negative.');

  const session = db.prepare(`
    SELECT s.*, t.patient_id, t.total_sessions
    FROM treatment_sessions s
    JOIN treatments t ON t.id = s.treatment_id
    WHERE s.id = ?
  `).get(sessionId);
  if (!session) throw new Error('Session not found.');

  const doctorId = doctorName ? upsertDoctor(db, doctorName) : null;
  db.prepare(`
    UPDATE treatment_sessions
    SET doctor_id = ?, visit_date = ?, next_appointment_date = ?, charges = ?, remarks = ?
    WHERE id = ?
  `).run(doctorId, visitDate, nextAppointmentDate, charges, remarks, sessionId);

  db.prepare(`
    UPDATE treatments
    SET next_appointment_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(nextAppointmentDate, session.treatment_id);

  return getPatientSummary(db, session.patient_id);
}

export function deleteSession(db, id) {
  const sessionId = Number(id || 0);
  if (!sessionId) throw new Error('Session is required.');
  const session = db.prepare(`
    SELECT s.*, t.patient_id
    FROM treatment_sessions s
    JOIN treatments t ON t.id = s.treatment_id
    WHERE s.id = ?
  `).get(sessionId);
  if (!session) throw new Error('Session not found.');

  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM treatment_sessions WHERE id = ?').run(sessionId);
    db.prepare(`
      UPDATE treatment_sessions
      SET session_number = session_number - 1
      WHERE treatment_id = ? AND session_number > ?
    `).run(session.treatment_id, session.session_number);
    const latest = db.prepare(`
      SELECT next_appointment_date
      FROM treatment_sessions
      WHERE treatment_id = ?
      ORDER BY session_number DESC
      LIMIT 1
    `).get(session.treatment_id);
    db.prepare(`
      UPDATE treatments
      SET status = 'active',
          next_appointment_date = COALESCE(?, next_appointment_date),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(latest?.next_appointment_date ?? null, session.treatment_id);
    const summary = getPatientSummary(db, session.patient_id);
    db.exec('COMMIT');
    return summary;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function treatmentStatusReport(db, { status, procedure, doctor, from, to } = {}) {
  const clauses = [];
  const params = [];
  const reportStatus = cleanStatus(status);
  const procedureName = cleanText(procedure);
  const doctorName = cleanText(doctor);

  if (reportStatus !== 'all') {
    clauses.push('t.status = ?');
    params.push(reportStatus);
  }
  if (procedureName) {
    clauses.push('t.procedure = ?');
    params.push(procedureName);
  }
  if (doctorName) {
    clauses.push('d.name = ?');
    params.push(doctorName);
  }
  addDateRangeClause(clauses, params, 't.started_at', from, to);

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`
      SELECT
        t.id AS treatment_id,
        t.status,
        t.started_at,
        t.next_appointment_date,
        t.diagnosis,
        t.procedure,
        t.total_sessions,
        t.charges,
        t.remarks,
        p.name AS patient_name,
        p.cnic,
        p.contact,
        d.name AS doctor_name,
        COUNT(s.id) AS completed_sessions,
        COALESCE(SUM(s.charges), 0) AS session_charges
      FROM treatments t
      JOIN patients p ON p.id = t.patient_id
      LEFT JOIN doctors d ON d.id = t.doctor_id
      LEFT JOIN treatment_sessions s ON s.treatment_id = t.id
      ${whereClause}
      GROUP BY t.id
      ORDER BY t.started_at DESC, t.id DESC
    `)
    .all(...params)
    .map((row) => ({
      ...row,
      remaining_sessions: Math.max(0, row.total_sessions - row.completed_sessions)
    }));

  return { rows, count: rows.length };
}

export function sessionReport(db, { procedure, from, to } = {}) {
  const clauses = [];
  const params = [];
  const procedureName = cleanText(procedure);

  if (procedureName) {
    clauses.push('t.procedure = ?');
    params.push(procedureName);
  }
  addDateRangeClause(clauses, params, 's.visit_date', from, to);

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`
      SELECT
        s.id AS session_id,
        s.session_number,
        s.visit_date,
        s.next_appointment_date,
        s.charges,
        s.remarks,
        t.id AS treatment_id,
        t.status,
        t.diagnosis,
        t.procedure,
        t.total_sessions,
        p.name AS patient_name,
        p.cnic,
        p.contact,
        d.name AS doctor_name
      FROM treatment_sessions s
      JOIN treatments t ON t.id = s.treatment_id
      JOIN patients p ON p.id = t.patient_id
      LEFT JOIN doctors d ON d.id = s.doctor_id
      ${whereClause}
      ORDER BY s.visit_date DESC, s.id DESC
    `)
    .all(...params);

  return {
    rows,
    count: rows.length,
    total_charges: rows.reduce((sum, row) => sum + Number(row.charges || 0), 0)
  };
}

export function reviewReport(db, { procedure, from, to } = {}) {
  const clauses = ["remarks IS NOT NULL", "TRIM(remarks) <> ''"];
  const params = [];
  const procedureName = cleanText(procedure);

  if (procedureName) {
    clauses.push('procedure = ?');
    params.push(procedureName);
  }
  addDateRangeClause(clauses, params, 'review_date', from, to);

  const whereClause = `WHERE ${clauses.join(' AND ')}`;
  const rows = db
    .prepare(`
      SELECT *
      FROM (
        SELECT
          'Diagnosis' AS review_type,
          t.started_at AS review_date,
          t.id AS treatment_id,
          NULL AS session_number,
          t.diagnosis,
          t.procedure,
          t.remarks,
          p.name AS patient_name,
          p.cnic,
          p.contact,
          d.name AS doctor_name
        FROM treatments t
        JOIN patients p ON p.id = t.patient_id
        LEFT JOIN doctors d ON d.id = t.doctor_id

        UNION ALL

        SELECT
          'Session' AS review_type,
          s.visit_date AS review_date,
          t.id AS treatment_id,
          s.session_number,
          t.diagnosis,
          t.procedure,
          s.remarks,
          p.name AS patient_name,
          p.cnic,
          p.contact,
          d.name AS doctor_name
        FROM treatment_sessions s
        JOIN treatments t ON t.id = s.treatment_id
        JOIN patients p ON p.id = t.patient_id
        LEFT JOIN doctors d ON d.id = s.doctor_id
      )
      ${whereClause}
      ORDER BY review_date DESC, treatment_id DESC, session_number DESC
    `)
    .all(...params);

  return { rows, count: rows.length };
}

export function doctorPerformanceReport(db, { from, to } = {}) {
  const clauses = [];
  const params = [];
  addDateRangeClause(clauses, params, 's.visit_date', from, to);
  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db
    .prepare(`
      SELECT
        COALESCE(d.name, 'Not set') AS doctor_name,
        COUNT(s.id) AS sessions_done,
        COUNT(DISTINCT t.patient_id) AS patients_seen,
        COUNT(DISTINCT t.id) AS treatments_seen,
        COALESCE(SUM(s.charges), 0) AS session_charges
      FROM treatment_sessions s
      JOIN treatments t ON t.id = s.treatment_id
      LEFT JOIN doctors d ON d.id = s.doctor_id
      ${whereClause}
      GROUP BY COALESCE(d.name, 'Not set')
      ORDER BY sessions_done DESC, doctor_name ASC
    `)
    .all(...params);

  return { rows, count: rows.length };
}

export function procedureReport(db, { from, to } = {}) {
  const clauses = [];
  const params = [];
  addDateRangeClause(clauses, params, 't.started_at', from, to);
  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db
    .prepare(`
      WITH treatment_totals AS (
        SELECT
          t.id,
          t.procedure,
          t.status,
          t.total_sessions,
          t.charges,
          COUNT(s.id) AS completed_sessions,
          COALESCE(SUM(s.charges), 0) AS session_charges
        FROM treatments t
        LEFT JOIN treatment_sessions s ON s.treatment_id = t.id
        ${whereClause}
        GROUP BY t.id
      )
      SELECT
        procedure,
        COUNT(id) AS treatment_count,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_count,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
        SUM(total_sessions) AS planned_sessions,
        SUM(completed_sessions) AS completed_sessions,
        COALESCE(SUM(session_charges), 0) AS session_charges,
        COALESCE(SUM(charges), 0) AS treatment_charges
      FROM treatment_totals
      GROUP BY procedure
      ORDER BY treatment_count DESC, procedure ASC
    `)
    .all(...params);

  return { rows, count: rows.length };
}

export function createVisit(db, payload) {
  const patientInput = payload.patient ?? {};
  const treatmentInput = payload.treatment ?? {};

  const patientName = cleanText(patientInput.name);
  const cnic = cleanText(patientInput.cnic);
  const contact = cleanText(patientInput.contact);
  const age = cleanNumber(patientInput.age);
  const gender = cleanText(patientInput.gender);

  const diagnosis = cleanText(treatmentInput.diagnosis);
  const procedure = cleanText(treatmentInput.procedure);
  const totalSessions = Math.trunc(cleanNumber(treatmentInput.totalSessions, 1));
  const charges = cleanNumber(treatmentInput.charges, 0);
  const doctorName = cleanText(treatmentInput.doctorName);
  const nextAppointmentDate = cleanText(treatmentInput.nextAppointmentDate);
  const remarks = cleanText(treatmentInput.remarks);

  if (!patientName) throw new Error('Patient name is required.');
  if (!cnic && !contact) throw new Error('CNIC or contact number is required.');
  if (charges < 0) throw new Error('Charges cannot be negative.');

  db.exec('BEGIN');
  try {
    const patientId = upsertPatient(db, { patientName, cnic, contact, age, gender });
    const doctorId = doctorName ? upsertDoctor(db, doctorName) : null;
    const activeTreatment = getActiveTreatment(db, patientId);

    let treatmentId = activeTreatment?.id;
    let completedSessions = activeTreatment?.completed_sessions ?? 0;
    let sessionNumber = completedSessions + 1;
    let createdTreatment = false;
    let recordedSession = false;
    let receiptType = 'diagnosis';

    if (!activeTreatment) {
      if (!diagnosis) throw new Error('Diagnosis is required.');
      if (!procedure) throw new Error('Procedure is required.');
      if (!Number.isInteger(totalSessions) || totalSessions < 1) {
        throw new Error('Number of sessions must be at least 1.');
      }

      const result = db
        .prepare(`
          INSERT INTO treatments (
            patient_id, doctor_id, diagnosis, procedure, total_sessions, charges, next_appointment_date, remarks
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(patientId, doctorId, diagnosis, procedure, totalSessions, charges, nextAppointmentDate, remarks);
      treatmentId = result.lastInsertRowid;
      sessionNumber = 1;
      completedSessions = 0;
      createdTreatment = true;
    } else {
      receiptType = 'session';
      db
        .prepare(`
          UPDATE treatments
          SET next_appointment_date = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .run(nextAppointmentDate, treatmentId);

      db
        .prepare(`
          INSERT INTO treatment_sessions (
            treatment_id, doctor_id, session_number, next_appointment_date, charges, remarks
          )
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(treatmentId, doctorId, sessionNumber, nextAppointmentDate, charges, remarks);
      recordedSession = true;
    }

    const treatment = getTreatmentById(db, treatmentId);
    const receipt = buildReceipt({
      patient: db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId),
      treatment,
      receiptType,
      sessionNumber,
      doctorName,
      charges,
      nextAppointmentDate,
      remarks
    });

    if (recordedSession && sessionNumber >= treatment.total_sessions) {
      db
        .prepare(`
          UPDATE treatments
          SET status = 'completed', next_appointment_date = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .run(treatmentId);
    }

    const result = {
      createdTreatment,
      recordedSession,
      sessionNumber,
      receipt,
      ...getPatientSummary(db, patientId),
      appointmentCount: nextAppointmentDate ? countAppointments(db, nextAppointmentDate).count : 0
    };

    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function buildReceipt({ patient, treatment, receiptType, sessionNumber, doctorName, charges, nextAppointmentDate, remarks }) {
  return {
    type: receiptType,
    printedAt: new Date().toISOString(),
    patient: {
      name: patient.name,
      cnic: patient.cnic,
      contact: patient.contact,
      age: patient.age,
      gender: patient.gender
    },
    treatment: {
      diagnosis: treatment.diagnosis,
      procedure: treatment.procedure,
      totalSessions: treatment.total_sessions,
      treatmentCharges: treatment.charges,
      diagnosisDoctor: doctorName || null,
      diagnosisRemarks: treatment.remarks
    },
    session: {
      sessionNumber,
      doctorName: doctorName || null,
      charges,
      nextAppointmentDate,
      remarks
    }
  };
}

function upsertPatient(db, { patientName, cnic, contact, age, gender }) {
  let existing = null;
  if (cnic) {
    existing = db.prepare('SELECT * FROM patients WHERE cnic = ?').get(cnic) ?? null;
  }
  if (!existing && !cnic && contact) {
    existing = db
      .prepare('SELECT * FROM patients WHERE contact = ? ORDER BY updated_at DESC, id DESC LIMIT 1')
      .get(contact) ?? null;
  }

  if (existing) {
    db
      .prepare(`
        UPDATE patients
        SET name = ?, cnic = COALESCE(?, cnic), contact = ?, age = ?, gender = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
      .run(patientName, cnic, contact, age, gender, existing.id);
    return existing.id;
  }

  const result = db
    .prepare('INSERT INTO patients (name, cnic, contact, age, gender) VALUES (?, ?, ?, ?, ?)')
    .run(patientName, cnic, contact, age, gender);
  return result.lastInsertRowid;
}

function upsertDoctor(db, name) {
  const key = doctorKey(name);
  const existing = db.prepare('SELECT id FROM doctors WHERE name_key = ?').get(key);
  if (existing) return existing.id;
  const result = db
    .prepare('INSERT INTO doctors (name, name_key) VALUES (?, ?)')
    .run(name, key);
  return result.lastInsertRowid;
}

function getTreatmentById(db, id) {
  return db.prepare('SELECT * FROM treatments WHERE id = ?').get(id);
}

export function getActiveTreatment(db, patientId) {
  const treatment = db
    .prepare(`
      SELECT
        t.*,
        d.name AS doctor_name,
        COUNT(s.id) AS completed_sessions,
        MAX(s.visit_date) AS last_visit_date
      FROM treatments t
      LEFT JOIN doctors d ON d.id = t.doctor_id
      LEFT JOIN treatment_sessions s ON s.treatment_id = t.id
      WHERE t.patient_id = ? AND t.status = 'active'
      GROUP BY t.id
      HAVING completed_sessions < t.total_sessions
      ORDER BY t.id DESC
      LIMIT 1
    `)
    .get(patientId);

  if (!treatment) return null;
  const sessions = db
    .prepare(`
      SELECT
        s.id,
        s.session_number,
        s.visit_date,
        s.next_appointment_date,
        s.charges,
        s.remarks,
        d.name AS doctor_name
      FROM treatment_sessions s
      LEFT JOIN doctors d ON d.id = s.doctor_id
      WHERE s.treatment_id = ?
      ORDER BY s.session_number ASC
    `)
    .all(treatment.id);

  return {
    ...treatment,
    remaining_sessions: treatment.total_sessions - treatment.completed_sessions,
    sessions
  };
}
