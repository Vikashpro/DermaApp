import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupDatabaseOnStart, openDatabase } from '../server/database.js';
import {
  countAppointments,
  createProcedure,
  createVisit,
  deleteDoctor,
  deletePatient,
  deleteProcedure,
  deleteSession,
  deleteTreatment,
  doctorPerformanceReport,
  getClinicSettings,
  listAppointments,
  listAppointmentsByDate,
  listDoctors,
  listProcedures,
  lookupPatient,
  procedureReport,
  reviewReport,
  saveDoctor,
  saveClinicSettings,
  saveProcedure,
  sessionReport,
  treatmentStatusReport,
  updateAppointmentDate,
  updatePatient,
  updateSession,
  updateTreatment
} from '../server/clinicService.js';

function testDb() {
  return openDatabase(join(mkdtempSync(join(tmpdir(), 'clinic-')), 'test.sqlite'));
}

function visit(overrides = {}) {
  return {
    patient: {
      name: 'Ayesha Khan',
      cnic: '35202-1234567-1',
      contact: '03001234567',
      age: 31,
      gender: 'Female',
      ...overrides.patient
    },
    treatment: {
      diagnosis: 'Acne',
      procedure: 'Chemical peel',
      totalSessions: 3,
      charges: 5000,
      doctorName: 'Dr Sana',
      nextAppointmentDate: '2026-05-20',
      remarks: 'Initial session',
      ...overrides.treatment
    }
  };
}

test('creates a new patient, doctor, and treatment without counting a session', () => {
  const db = testDb();
  const result = createVisit(db, visit());

  assert.equal(result.createdTreatment, true);
  assert.equal(result.recordedSession, false);
  assert.equal(result.sessionNumber, 1);
  assert.equal(result.patient.name, 'Ayesha Khan');
  assert.equal(result.activeTreatment.completed_sessions, 0);
  assert.equal(result.activeTreatment.remaining_sessions, 3);
  assert.equal(result.activeTreatment.next_appointment_date, '2026-05-20');
  assert.equal(result.receipt.type, 'diagnosis');
  assert.equal(result.receipt.session.nextAppointmentDate, '2026-05-20');
  assert.equal(listDoctors(db, 'sana')[0].name, 'Dr Sana');
});

test('looks up by CNIC and by contact when CNIC is empty', () => {
  const db = testDb();
  createVisit(db, visit());

  assert.equal(lookupPatient(db, { cnic: '35202-1234567-1' }).patient.name, 'Ayesha Khan');
  assert.equal(lookupPatient(db, { contact: '03001234567' }).patient.name, 'Ayesha Khan');
  assert.equal(lookupPatient(db, { cnic: '', contact: '03001234567' }).patient.name, 'Ayesha Khan');
});

test('prefers CNIC when CNIC and contact belong to different patients', () => {
  const db = testDb();
  createVisit(db, visit());
  createVisit(db, visit({
    patient: {
      name: 'Zara Ali',
      cnic: '35202-9999999-1',
      contact: '03111111111'
    }
  }));

  const result = createVisit(db, visit({
    patient: {
      name: 'Ayesha Updated',
      cnic: '35202-1234567-1',
      contact: '03111111111'
    }
  }));

  assert.equal(result.patient.name, 'Ayesha Updated');
  assert.equal(result.patient.cnic, '35202-1234567-1');
  assert.equal(result.patient.contact, '03111111111');
});

test('adds sessions to an active treatment until completed, then starts a new treatment', () => {
  const db = testDb();
  createVisit(db, visit({ treatment: { totalSessions: 2 } }));
  const firstSession = createVisit(db, visit({ treatment: { totalSessions: 2 } }));
  const secondSession = createVisit(db, visit({ treatment: { totalSessions: 2 } }));

  assert.equal(firstSession.recordedSession, true);
  assert.equal(firstSession.sessionNumber, 1);
  assert.equal(firstSession.activeTreatment.completed_sessions, 1);
  assert.equal(secondSession.sessionNumber, 2);
  assert.equal(secondSession.activeTreatment, null);

  const third = createVisit(db, visit({ treatment: { procedure: 'Laser', totalSessions: 4 } }));
  assert.equal(third.createdTreatment, true);
  assert.equal(third.recordedSession, false);
  assert.equal(third.sessionNumber, 1);
  assert.equal(third.activeTreatment.procedure, 'Laser');
  assert.equal(third.activeTreatment.completed_sessions, 0);
});

test('records an active session without rewriting treatment details', () => {
  const db = testDb();
  createVisit(db, visit({
    treatment: {
      diagnosis: 'Melasma',
      procedure: 'Laser toning',
      totalSessions: 3,
      charges: 9000,
      doctorName: 'Dr Initial',
      remarks: 'Diagnosis note'
    }
  }));

  const session = createVisit(db, {
    patient: {
      name: 'Ayesha Khan',
      cnic: '35202-1234567-1',
      contact: '03001234567',
      age: 31,
      gender: 'Female'
    },
    treatment: {
      charges: 2500,
      doctorName: 'Dr Session',
      nextAppointmentDate: '2026-05-25',
      remarks: 'Session note'
    }
  });

  assert.equal(session.recordedSession, true);
  assert.equal(session.sessionNumber, 1);
  assert.equal(session.activeTreatment.diagnosis, 'Melasma');
  assert.equal(session.activeTreatment.procedure, 'Laser toning');
  assert.equal(session.activeTreatment.charges, 9000);
  assert.equal(session.activeTreatment.remarks, 'Diagnosis note');
  assert.equal(session.activeTreatment.next_appointment_date, '2026-05-25');
  assert.equal(session.activeTreatment.sessions.length, 1);
  assert.equal(session.activeTreatment.sessions[0].doctor_name, 'Dr Session');
  assert.equal(session.activeTreatment.sessions[0].charges, 2500);
  assert.equal(session.receipt.type, 'session');
  assert.equal(session.receipt.session.sessionNumber, 1);
  assert.equal(session.receipt.session.nextAppointmentDate, '2026-05-25');
});

test('counts active treatments scheduled on the selected next appointment date', () => {
  const db = testDb();
  createVisit(db, visit({ treatment: { nextAppointmentDate: '2026-05-20' } }));
  createVisit(db, visit({
    patient: { cnic: '35202-7654321-1', contact: '03007654321' },
    treatment: { nextAppointmentDate: '2026-05-20' }
  }));
  createVisit(db, visit({
    patient: { cnic: '35202-0000000-1', contact: '03000000000' },
    treatment: { nextAppointmentDate: '2026-05-21' }
  }));

  assert.equal(countAppointments(db, '2026-05-20').count, 2);
  assert.equal(countAppointments(db, '2026-05-21').count, 1);
  const list = listAppointmentsByDate(db, '2026-05-20');
  assert.equal(list.count, 2);
  assert.equal(list.appointments[0].next_session_number, 1);
  const rangeList = listAppointments(db, { from: '2026-05-20', to: '2026-05-21', search: 'Chemical' });
  assert.equal(rangeList.count, 3);
  assert.equal(listAppointments(db, { from: '2026-05-20', to: '2026-05-21', search: '7654321' }).count, 1);
  assert.equal(listAppointments(db, { from: '2026-05-20', mode: 'future' }).count, 3);
  assert.equal(listAppointments(db, { from: '2026-05-20', mode: 'today' }).count, 2);
  const treatmentId = list.appointments[0].treatment_id;
  updateAppointmentDate(db, { treatmentId, nextAppointmentDate: '2026-05-30' });
  assert.equal(listAppointmentsByDate(db, '2026-05-30').appointments[0].treatment_id, treatmentId);
});

test('adds procedures to the selectable catalog without duplicates', () => {
  const db = testDb();
  const first = createProcedure(db, 'Hydra Facial');
  const duplicate = createProcedure(db, ' hydra   facial ');

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.deepEqual(listProcedures(db, 'hydra').map((procedure) => procedure.name), ['Hydra Facial']);
});

test('updates and deletes procedure and doctor catalog records when unused', () => {
  const db = testDb();
  const procedure = createProcedure(db, 'Hydra Facial').procedure;
  const updatedProcedure = saveProcedure(db, { id: procedure.id, name: 'Hydra Cleanse' });
  assert.equal(updatedProcedure.procedure.name, 'Hydra Cleanse');
  assert.equal(deleteProcedure(db, procedure.id).deleted, true);

  const doctor = saveDoctor(db, { name: 'Dr Amina' }).doctor;
  const updatedDoctor = saveDoctor(db, { id: doctor.id, name: 'Dr Amina Khan' });
  assert.equal(updatedDoctor.doctor.name, 'Dr Amina Khan');
  assert.equal(deleteDoctor(db, doctor.id).deleted, true);
});

test('updates patient, treatment, and session records and deletes editable records safely', () => {
  const db = testDb();
  const diagnosis = createVisit(db, visit({ treatment: { totalSessions: 3 } }));
  const patientId = diagnosis.patient.id;
  const treatmentId = diagnosis.activeTreatment.id;

  const patientUpdate = updatePatient(db, {
    id: patientId,
    name: 'Ayesha Updated',
    cnic: '35202-1234567-1',
    contact: '03009999999',
    age: 32,
    gender: 'Female'
  });
  assert.equal(patientUpdate.patient.name, 'Ayesha Updated');
  assert.throws(() => deletePatient(db, patientId), /treatment records/);

  const treatmentUpdate = updateTreatment(db, {
    id: treatmentId,
    diagnosis: 'Acne scars',
    procedure: 'Chemical peel',
    totalSessions: 4,
    charges: 7000,
    doctorName: 'Dr Sana',
    nextAppointmentDate: '2026-05-22',
    remarks: 'Updated plan',
    status: 'active'
  });
  assert.equal(treatmentUpdate.activeTreatment.diagnosis, 'Acne scars');
  assert.equal(treatmentUpdate.activeTreatment.total_sessions, 4);

  const session = createVisit(db, visit({
    treatment: {
      doctorName: 'Dr Sana',
      nextAppointmentDate: '2026-05-29',
      charges: 2000,
      remarks: 'Done'
    }
  }));
  const sessionId = session.activeTreatment.sessions[0].id;
  const sessionUpdate = updateSession(db, {
    id: sessionId,
    visitDate: '2026-05-23',
    doctorName: 'Dr Session',
    charges: 2500,
    nextAppointmentDate: '2026-06-01',
    remarks: 'Updated session'
  });
  assert.equal(sessionUpdate.activeTreatment.sessions[0].doctor_name, 'Dr Session');
  assert.equal(sessionUpdate.activeTreatment.sessions[0].charges, 2500);

  const afterDeleteSession = deleteSession(db, sessionId);
  assert.equal(afterDeleteSession.activeTreatment.sessions.length, 0);

  const afterDeleteTreatment = deleteTreatment(db, treatmentId);
  assert.equal(afterDeleteTreatment.activeTreatment, null);
  assert.equal(deletePatient(db, patientId).deleted, true);
});

test('saves clinic settings for export headers', () => {
  const db = testDb();
  const settings = saveClinicSettings(db, {
    clinicName: 'Skin Care Clinic',
    contact: '03001234567',
    email: 'info@skin.test',
    address: 'Main Road Lahore'
  });

  assert.equal(settings.clinic_name, 'Skin Care Clinic');
  assert.equal(settings.contact, '03001234567');
  assert.equal(getClinicSettings(db).address, 'Main Road Lahore');
});

test('creates one startup database backup per day', () => {
  const directory = mkdtempSync(join(tmpdir(), 'clinic-backup-'));
  const databasePath = join(directory, 'test.sqlite');
  const backupDirectory = join(directory, 'backups');
  openDatabase(databasePath);

  const first = backupDatabaseOnStart(databasePath, backupDirectory);
  const second = backupDatabaseOnStart(databasePath, backupDirectory);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.backupPath, second.backupPath);
  assert.equal(existsSync(first.backupPath), true);
});

test('returns treatment, session, review, doctor, and procedure reports', () => {
  const db = testDb();
  createVisit(db, visit({
    treatment: {
      totalSessions: 2,
      nextAppointmentDate: '2026-05-20',
      remarks: 'Diagnosis review'
    }
  }));
  createVisit(db, visit({
    treatment: {
      charges: 1500,
      doctorName: 'Dr Sana',
      nextAppointmentDate: '2026-05-25',
      remarks: 'Session review'
    }
  }));

  const treatments = treatmentStatusReport(db, {
    status: 'active',
    procedure: 'Chemical peel',
    doctor: 'Dr Sana',
    from: '2026-05-01',
    to: '2026-05-31'
  });
  assert.equal(treatments.count, 1);
  assert.equal(treatments.rows[0].completed_sessions, 1);
  assert.equal(treatmentStatusReport(db, { status: 'completed', procedure: 'Chemical peel' }).count, 0);
  assert.equal(treatmentStatusReport(db, { status: 'active', doctor: 'Unknown Doctor' }).count, 0);

  const sessions = sessionReport(db, { procedure: 'Chemical peel', from: '2026-05-01', to: '2026-05-31' });
  assert.equal(sessions.count, 1);
  assert.equal(sessions.total_charges, 1500);

  const reviews = reviewReport(db, { procedure: 'Chemical peel', from: '2026-05-01', to: '2026-05-31' });
  assert.equal(reviews.count, 2);

  const doctors = doctorPerformanceReport(db, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(doctors.rows[0].doctor_name, 'Dr Sana');
  assert.equal(doctors.rows[0].sessions_done, 1);

  const procedures = procedureReport(db, { from: '2026-05-01', to: '2026-05-31' });
  assert.equal(procedures.rows[0].procedure, 'Chemical peel');
  assert.equal(procedures.rows[0].treatment_count, 1);
  assert.equal(procedures.rows[0].completed_sessions, 1);
});
