import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './database.js';
import { ensureDefaultAdmin, getUserByToken, listUsers, login, logout, saveUser } from './authService.js';
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
  sessionReport,
  saveClinicSettings,
  saveProcedure,
  treatmentStatusReport,
  updateAppointmentDate,
  updatePatient,
  updateSession,
  updateTreatment
} from './clinicService.js';

export function createApp(db = openDatabase()) {
  ensureDefaultAdmin(db);
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const result = login(db, req.body ?? {});
      res.setHeader('Set-Cookie', sessionCookie(result.token));
      res.json({ user: result.user });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to login.';
      res.status(401).json({ error: message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    logout(db, getSessionToken(req));
    res.setHeader('Set-Cookie', 'clinic_session=; Path=/; Max-Age=0; SameSite=Lax');
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    res.json({ user: getUserByToken(db, getSessionToken(req)) });
  });

  app.use('/api', (req, res, next) => {
    const user = getUserByToken(db, getSessionToken(req));
    if (!user) {
      res.status(401).json({ error: 'Login required.' });
      return;
    }
    req.user = user;
    next();
  });

  app.get('/api/patients/lookup', (req, res) => {
    res.json(lookupPatient(db, req.query));
  });

  app.post('/api/patients', (req, res) => {
    try {
      res.json(updatePatient(db, req.body ?? {}));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save patient.';
      res.status(400).json({ error: message });
    }
  });

  app.delete('/api/patients/:id', (req, res) => {
    try {
      res.json(deletePatient(db, req.params.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete patient.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/doctors', (req, res) => {
    res.json({ doctors: listDoctors(db, req.query.search ?? '') });
  });

  app.post('/api/doctors', (req, res) => {
    try {
      res.json(saveDoctor(db, req.body ?? {}));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save doctor.';
      res.status(400).json({ error: message });
    }
  });

  app.delete('/api/doctors/:id', (req, res) => {
    try {
      res.json(deleteDoctor(db, req.params.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete doctor.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/procedures', (req, res) => {
    res.json({ procedures: listProcedures(db, req.query.search ?? '') });
  });

  app.post('/api/procedures', (req, res) => {
    try {
      const result = req.body?.id ? saveProcedure(db, req.body) : createProcedure(db, req.body?.name);
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save procedure.';
      res.status(400).json({ error: message });
    }
  });

  app.delete('/api/procedures/:id', (req, res) => {
    try {
      res.json(deleteProcedure(db, req.params.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete procedure.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/appointments/count', (req, res) => {
    res.json(countAppointments(db, req.query.date));
  });

  app.get('/api/appointments', (req, res) => {
    if (req.query.date) {
      res.json(listAppointmentsByDate(db, req.query.date));
      return;
    }
    res.json(listAppointments(db, req.query));
  });

  app.post('/api/appointments/update-date', (req, res) => {
    try {
      res.json({ appointment: updateAppointmentDate(db, req.body ?? {}) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update appointment date.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/visits', (req, res) => {
    try {
      res.status(201).json(createVisit(db, req.body));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save visit.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/treatments', (req, res) => {
    try {
      res.json(updateTreatment(db, req.body ?? {}));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save treatment.';
      res.status(400).json({ error: message });
    }
  });

  app.delete('/api/treatments/:id', (req, res) => {
    try {
      res.json(deleteTreatment(db, req.params.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete treatment.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/sessions', (req, res) => {
    try {
      res.json(updateSession(db, req.body ?? {}));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save session.';
      res.status(400).json({ error: message });
    }
  });

  app.delete('/api/sessions/:id', (req, res) => {
    try {
      res.json(deleteSession(db, req.params.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete session.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/settings', (_req, res) => {
    res.json({ settings: getClinicSettings(db) });
  });

  app.post('/api/settings', requireAdmin, (req, res) => {
    try {
      res.json({ settings: saveClinicSettings(db, req.body ?? {}) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save settings.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/reports/treatments', (req, res) => {
    try {
      res.json(treatmentStatusReport(db, req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load treatment report.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/reports/sessions', (req, res) => {
    try {
      res.json(sessionReport(db, req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load session report.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/reports/reviews', (req, res) => {
    try {
      res.json(reviewReport(db, req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load review report.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/reports/doctors', (req, res) => {
    try {
      res.json(doctorPerformanceReport(db, req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load doctor performance report.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/reports/procedures', (req, res) => {
    try {
      res.json(procedureReport(db, req.query));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load procedure report.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/users', requireAdmin, (_req, res) => {
    res.json({ users: listUsers(db) });
  });

  app.post('/api/users', requireAdmin, (req, res) => {
    try {
      res.json({ user: saveUser(db, req.body ?? {}) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save user.';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/backup', requireAdmin, (_req, res) => {
    const backupName = `clinic-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
    res.download(resolve('data', 'clinic.sqlite'), backupName);
  });

  const distPath = resolve('client', 'dist');
  if (existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get(/.*/, (_req, res) => {
      res.sendFile(resolve(distPath, 'index.html'));
    });
  }

  return app;
}

function getSessionToken(req) {
  const cookie = req.headers.cookie ?? '';
  const match = cookie.match(/(?:^|;\s*)clinic_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function sessionCookie(token) {
  return `clinic_session=${encodeURIComponent(token)}; Path=/; Max-Age=${7 * 24 * 60 * 60}; SameSite=Lax; HttpOnly`;
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required.' });
    return;
  }
  next();
}
