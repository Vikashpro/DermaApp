import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const emptyPatient = {
  name: '',
  cnic: '',
  contact: '',
  age: '',
  gender: ''
};

const emptyTreatment = {
  diagnosis: '',
  procedure: '',
  totalSessions: 1,
  charges: '',
  doctorName: '',
  nextAppointmentDate: '',
  remarks: ''
};

const defaultClinicSettings = {
  clinic_name: 'Dermatology Clinic',
  contact: '',
  email: '',
  address: ''
};

function formatCnic(value) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 13);
  if (digits.length <= 5) return digits;
  if (digits.length <= 12) return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
}

function App() {
  const [page, setPage] = useState(getPageFromPath());
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [patient, setPatient] = useState(emptyPatient);
  const [treatment, setTreatment] = useState(emptyTreatment);
  const [lookup, setLookup] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [procedures, setProcedures] = useState([]);
  const [clinicSettings, setClinicSettings] = useState(defaultClinicSettings);
  const [newProcedureName, setNewProcedureName] = useState('');
  const [sameDateCount, setSameDateCount] = useState(0);
  const [sameDateAppointments, setSameDateAppointments] = useState([]);
  const [appointmentEditMode, setAppointmentEditMode] = useState(false);
  const [selectedAppointmentDate, setSelectedAppointmentDate] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lookupTimer = useRef(null);
  const lookupRequestId = useRef(0);

  useEffect(() => {
    function handlePopState() {
      setPage(getPageFromPath());
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((response) => response.json())
      .then((data) => setCurrentUser(data.user ?? null))
      .finally(() => setAuthChecked(true));
  }, []);

  const activeTreatment = lookup?.activeTreatment ?? null;
  const activeStatus = useMemo(() => {
    if (!activeTreatment) return 'No active treatment. Submit will save diagnosis and schedule session 1.';
    const nextSession = Number(activeTreatment.completed_sessions) + 1;
    const scheduledDate = activeTreatment.next_appointment_date
      ? ` Session ${nextSession} scheduled for ${activeTreatment.next_appointment_date}.`
      : ` Session ${nextSession} is not scheduled yet.`;
    return `Active treatment: ${activeTreatment.completed_sessions}/${activeTreatment.total_sessions} sessions complete, ${activeTreatment.remaining_sessions} remaining.${scheduledDate}`;
  }, [activeTreatment]);

  useEffect(() => {
    clearTimeout(lookupTimer.current);
    const cnic = patient.cnic.trim();
    const contact = patient.contact.trim();
    if (!cnic && !contact) {
      setLookup(null);
      return;
    }

    const requestId = lookupRequestId.current + 1;
    lookupRequestId.current = requestId;

    lookupTimer.current = setTimeout(async () => {
      const params = new URLSearchParams({ cnic, contact });
      const response = await fetch(`/api/patients/lookup?${params}`);
      const data = await response.json();
      if (requestId !== lookupRequestId.current) return;
      setLookup(data);
      if (data.patient) {
        setPatient((current) => ({
          ...current,
          name: data.patient.name ?? '',
          cnic: data.patient.cnic ?? current.cnic,
          contact: data.patient.contact ?? current.contact,
          age: data.patient.age ?? '',
          gender: data.patient.gender ?? ''
        }));
      }
      if (data.activeTreatment) {
        setTreatment((current) => ({
          ...current,
          diagnosis: data.activeTreatment.diagnosis ?? '',
          procedure: data.activeTreatment.procedure ?? '',
          totalSessions: data.activeTreatment.total_sessions ?? 1,
          charges: '',
          doctorName: '',
          nextAppointmentDate: appointmentEditMode ? selectedAppointmentDate : '',
          remarks: ''
        }));
      }
    }, 350);

    return () => clearTimeout(lookupTimer.current);
  }, [patient.cnic, patient.contact]);

  useEffect(() => {
    const date = treatment.nextAppointmentDate;
    if (!date) {
      setSameDateCount(0);
      setSameDateAppointments([]);
      return;
    }
    fetch(`/api/appointments?date=${encodeURIComponent(date)}`)
      .then((response) => response.json())
      .then((data) => {
        setSameDateCount(data.count ?? 0);
        setSameDateAppointments(data.appointments ?? []);
      })
      .catch(() => {
        setSameDateCount(0);
        setSameDateAppointments([]);
      });
  }, [treatment.nextAppointmentDate]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/doctors?search=${encodeURIComponent(treatment.doctorName)}`, {
      signal: controller.signal
    })
      .then((response) => response.json())
      .then((data) => setDoctors(data.doctors ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [treatment.doctorName]);

  useEffect(() => {
    if (currentUser) {
      loadProcedures().catch(() => {});
      loadClinicSettings().catch(() => {});
    }
  }, [currentUser]);

  function updatePatient(field, value) {
    setPatient((current) => ({
      ...current,
      [field]: field === 'cnic' ? formatCnic(value) : value
    }));
  }

  function updateTreatment(field, value) {
    setTreatment((current) => ({ ...current, [field]: value }));
  }

  async function loadProcedures() {
    const response = await fetch('/api/procedures');
    if (!response.ok) throw new Error('Unable to load procedures.');
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('Procedure API is not available. Restart the local server and refresh the page.');
    }
    const data = await response.json();
    setProcedures(data.procedures ?? []);
  }

  async function loadClinicSettings() {
    const response = await fetch('/api/settings');
    const data = await response.json();
    if (response.ok) {
      setClinicSettings({
        ...defaultClinicSettings,
        ...(data.settings ?? {})
      });
    }
  }

  async function handleAddProcedure(event) {
    event.preventDefault();
    setError('');
    setMessage('');

    try {
      const response = await fetch('/api/procedures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProcedureName })
      });
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Procedure API is not available. Restart the local server and refresh the page.');
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to save procedure.');

      await loadProcedures();
      setNewProcedureName('');
      setMessage(data.created ? 'Procedure added.' : 'Procedure already exists.');
    } catch (procedureError) {
      setError(procedureError.message);
    }
  }

  function navigate(nextPage) {
    const path = nextPage === 'appointments'
      ? '/appointments'
      : nextPage === 'procedures'
        ? '/procedures'
        : nextPage === 'reports'
          ? '/reports'
          : nextPage === 'settings'
            ? '/settings'
            : nextPage === 'users'
            ? '/users'
            : '/';
    window.history.pushState({}, '', path);
    setPage(nextPage);
    setMessage('');
    setError('');
  }

  function openDashboardAppointment(appointment, mode) {
    setAppointmentEditMode(mode === 'edit');
    setSelectedAppointmentDate(appointment.next_appointment_date || '');
    setPatient({
      name: appointment.patient_name || '',
      cnic: appointment.cnic || '',
      contact: appointment.contact || '',
      age: '',
      gender: ''
    });
    setTreatment((current) => ({
      ...current,
      diagnosis: appointment.diagnosis || '',
      procedure: appointment.procedure || '',
      totalSessions: appointment.total_sessions || 1,
      charges: '',
      doctorName: '',
      nextAppointmentDate: mode === 'edit' ? appointment.next_appointment_date || '' : '',
      remarks: ''
    }));
    navigate('appointments');
  }

  function resetAppointmentForm() {
    clearTimeout(lookupTimer.current);
    lookupRequestId.current += 1;
    setPatient(emptyPatient);
    setTreatment(emptyTreatment);
    setLookup(null);
    setSameDateCount(0);
    setSameDateAppointments([]);
    setAppointmentEditMode(false);
    setSelectedAppointmentDate('');
    setMessage('');
    setError('');
  }

  async function handleUpdateAppointmentDate(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/appointments/update-date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          treatmentId: activeTreatment?.id,
          nextAppointmentDate: treatment.nextAppointmentDate
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to update appointment date.');
      setLookup((current) => current ? {
        ...current,
        activeTreatment: current.activeTreatment ? {
          ...current.activeTreatment,
          next_appointment_date: data.appointment.next_appointment_date
        } : current.activeTreatment
      } : current);
      setSelectedAppointmentDate(data.appointment.next_appointment_date);
      setMessage('Appointment date updated.');
      setAppointmentEditMode(false);
    } catch (updateError) {
      setError(updateError.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const receiptWindow = window.open('', 'clinic-receipt', 'width=420,height=720');
    if (receiptWindow) {
      receiptWindow.document.open();
      receiptWindow.document.write('<!doctype html><html><head><title>Preparing receipt</title></head><body style="font-family:Arial,sans-serif;padding:20px;">Preparing receipt...</body></html>');
      receiptWindow.document.close();
    }
    setSaving(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch('/api/visits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient, treatment })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to save visit.');

      setLookup({
        matched: true,
        matchedBy: 'submit',
        patient: data.patient,
        activeTreatment: data.activeTreatment
      });
      setSameDateCount(data.appointmentCount ?? sameDateCount);
      if (data.createdTreatment) {
        const dateText = treatment.nextAppointmentDate ? ` Session 1 scheduled for ${treatment.nextAppointmentDate}.` : '';
        setMessage(`Saved diagnosis.${dateText}`);
      } else {
        setMessage(`Saved session ${data.sessionNumber}. ${data.activeTreatment ? 'Treatment remains active.' : 'Treatment completed.'}`);
      }
      if (data.receipt) {
        if (receiptWindow) {
          receiptWindow.document.open();
          receiptWindow.document.write(renderReceiptWindowHtml(data.receipt));
          receiptWindow.document.close();
          receiptWindow.focus();
        }
      }
      setTreatment((current) => ({
        ...current,
        nextAppointmentDate: '',
        remarks: ''
      }));
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  if (page === 'receipt') {
    return <ReceiptWindowPage />;
  }

  if (!authChecked) {
    return <main className="app-shell"><div className="entry-form">Loading...</div></main>;
  }

  if (!currentUser) {
    return <LoginPage onLogin={setCurrentUser} />;
  }

  return (
    <>
    <main className="app-shell">
      <nav className="top-nav" aria-label="Primary">
        <button type="button" className={page === 'dashboard' ? 'nav-button active' : 'nav-button'} onClick={() => navigate('dashboard')}>
          Dashboard
        </button>
        <button type="button" className={page === 'appointments' ? 'nav-button active' : 'nav-button'} onClick={() => navigate('appointments')}>
          Appointments
        </button>
        <button type="button" className={page === 'procedures' ? 'nav-button active' : 'nav-button'} onClick={() => navigate('procedures')}>
          Procedure
        </button>
        <button type="button" className={page === 'reports' ? 'nav-button active' : 'nav-button'} onClick={() => navigate('reports')}>
          Reports
        </button>
        {currentUser.role === 'admin' && (
          <>
            <button type="button" className={page === 'settings' ? 'nav-button active' : 'nav-button'} onClick={() => navigate('settings')}>
              Settings
            </button>
            <button type="button" className={page === 'users' ? 'nav-button active' : 'nav-button'} onClick={() => navigate('users')}>
              Users
            </button>
            <a className="nav-button nav-link-button" href="/api/backup">
              Backup
            </a>
          </>
        )}
        <button type="button" className="nav-button" onClick={async () => {
          await fetch('/api/auth/logout', { method: 'POST' });
          setCurrentUser(null);
          navigate('dashboard');
        }}>
          Logout
        </button>
      </nav>

      <section className="status-band" aria-live="polite">
        <div>
          <span className="clinic-page-title">{clinicSettings.clinic_name || defaultClinicSettings.clinic_name}</span>
          <h1>{page === 'procedures' ? 'Procedure Management' : page === 'reports' ? 'Reports' : page === 'settings' ? 'Clinic Settings' : page === 'users' ? 'Users & Backup' : page === 'dashboard' ? 'Today Appointments' : 'Appointment & Treatment Entry'}</h1>
        </div>
        {page === 'appointments' ? (
          <div className="status-grid">
            <StatusItem label="Patient" value={lookup?.patient ? lookup.patient.name : 'New or not found'} />
            <StatusItem label="Treatment" value={activeStatus} />
            <StatusItem label="Same date appointments" value={treatment.nextAppointmentDate ? sameDateCount : 'Select date'} />
          </div>
        ) : (
          <div className="status-grid procedure-status">
            <StatusItem label="Saved procedures" value={procedures.length} />
            <StatusItem label="Use" value="Select these procedures on the treatment form." />
          </div>
        )}
      </section>

      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice error">{error}</div>}

      {page === 'dashboard' ? (
        <DashboardPage onOpenAppointment={openDashboardAppointment} clinicSettings={clinicSettings} />
      ) : page === 'users' ? (
        <UsersPage />
      ) : page === 'settings' ? (
        <SettingsPage clinicSettings={clinicSettings} setClinicSettings={setClinicSettings} />
      ) : page === 'reports' ? (
        <ReportsPage procedures={procedures} clinicSettings={clinicSettings} />
      ) : page === 'procedures' ? (
        <ProcedurePage
          newProcedureName={newProcedureName}
          procedures={procedures}
          setNewProcedureName={setNewProcedureName}
          handleAddProcedure={handleAddProcedure}
        />
      ) : (
      <div className="appointment-workspace">
      <form className="entry-form" onSubmit={appointmentEditMode ? handleUpdateAppointmentDate : handleSubmit}>
        <div className="form-toolbar">
          <button type="button" onClick={resetAppointmentForm}>New</button>
        </div>
        <fieldset>
          <legend>Patient Info</legend>
          <div className="form-grid">
            <Field label="Name" required>
              <input value={patient.name} onChange={(e) => updatePatient('name', e.target.value)} required />
            </Field>
            <Field label="CNIC">
              <input
                value={patient.cnic}
                onChange={(e) => updatePatient('cnic', e.target.value)}
                placeholder="35202-1234567-1"
                inputMode="numeric"
                maxLength="15"
              />
            </Field>
            <Field label="Contact No">
              <input value={patient.contact} onChange={(e) => updatePatient('contact', e.target.value)} placeholder="03001234567" />
            </Field>
            <Field label="Age">
              <input type="number" min="0" value={patient.age} onChange={(e) => updatePatient('age', e.target.value)} />
            </Field>
            <Field label="Gender">
              <select value={patient.gender} onChange={(e) => updatePatient('gender', e.target.value)}>
                <option value="">Select gender</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Other">Other</option>
              </select>
            </Field>
          </div>
        </fieldset>

        {activeTreatment ? (
          <>
            <TreatmentSummary treatment={activeTreatment} />
            {appointmentEditMode ? (
              <fieldset>
                <legend>Edit Appointment Date</legend>
                <div className="form-grid">
                  <Field label="Next Appointment Date" required>
                    <input type="date" value={treatment.nextAppointmentDate} onChange={(e) => updateTreatment('nextAppointmentDate', e.target.value)} required />
                  </Field>
                </div>
              </fieldset>
            ) : (
              <fieldset>
                <legend>Session {Number(activeTreatment.completed_sessions) + 1}</legend>
                <div className="form-grid">
                  <Field label="Doctor Name">
                    <input
                      list="doctor-list"
                      value={treatment.doctorName}
                      onChange={(e) => updateTreatment('doctorName', e.target.value)}
                      placeholder="Doctor who performed this session"
                    />
                    <datalist id="doctor-list">
                      {doctors.map((doctor) => (
                        <option key={doctor.id} value={doctor.name} />
                      ))}
                    </datalist>
                  </Field>
                  <Field label="Charges (PKR)">
                    <input type="number" min="0" step="0.01" value={treatment.charges} onChange={(e) => updateTreatment('charges', e.target.value)} />
                  </Field>
                  <Field label="Next Appointment Date">
                    <input type="date" value={treatment.nextAppointmentDate} onChange={(e) => updateTreatment('nextAppointmentDate', e.target.value)} />
                  </Field>
                  <Field label="Remarks" wide>
                    <textarea value={treatment.remarks} onChange={(e) => updateTreatment('remarks', e.target.value)} rows="4" />
                  </Field>
                </div>
              </fieldset>
            )}
          </>
        ) : (
          <fieldset>
            <legend>Diagnosis & Treatment</legend>
            <div className="form-grid">
              <Field label="Diagnosis" required>
                <input value={treatment.diagnosis} onChange={(e) => updateTreatment('diagnosis', e.target.value)} required />
              </Field>
              <Field label="Procedure" required>
                <select value={treatment.procedure} onChange={(e) => updateTreatment('procedure', e.target.value)} required>
                  <option value="">Select procedure</option>
                  {procedures.map((procedure) => (
                    <option key={procedure.id} value={procedure.name}>
                      {procedure.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="No. of Sessions" required>
                <input
                  type="number"
                  min="1"
                  value={treatment.totalSessions}
                  onChange={(e) => updateTreatment('totalSessions', e.target.value)}
                  required
                />
              </Field>
              <Field label="Charges (PKR)">
                <input type="number" min="0" step="0.01" value={treatment.charges} onChange={(e) => updateTreatment('charges', e.target.value)} />
              </Field>
              <Field label="Doctor Name">
                <input
                  list="doctor-list"
                  value={treatment.doctorName}
                  onChange={(e) => updateTreatment('doctorName', e.target.value)}
                  placeholder="Type or select doctor"
                />
                <datalist id="doctor-list">
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.name} />
                  ))}
                </datalist>
              </Field>
              <Field label="Session 1 Appointment Date">
                <input type="date" value={treatment.nextAppointmentDate} onChange={(e) => updateTreatment('nextAppointmentDate', e.target.value)} />
              </Field>
              <Field label="Remarks" wide>
                <textarea value={treatment.remarks} onChange={(e) => updateTreatment('remarks', e.target.value)} rows="4" />
              </Field>
            </div>
          </fieldset>
        )}

        <div className="actions">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : appointmentEditMode ? 'Update Appointment Date' : activeTreatment ? `Save Session ${Number(activeTreatment.completed_sessions) + 1}` : 'Save Diagnosis'}
          </button>
          {appointmentEditMode && (
            <button type="button" disabled={saving} onClick={() => setAppointmentEditMode(false)}>
              Cancel Edit
            </button>
          )}
        </div>
      </form>
      <SameDateAppointmentsPanel date={treatment.nextAppointmentDate} appointments={sameDateAppointments} />
      </div>
      )}
    </main>
    </>
  );
}

function getPageFromPath() {
  if (window.location.pathname === '/appointments') return 'appointments';
  if (window.location.pathname === '/procedures') return 'procedures';
  if (window.location.pathname === '/reports') return 'reports';
  if (window.location.pathname === '/settings') return 'settings';
  if (window.location.pathname === '/users') return 'users';
  if (window.location.pathname === '/receipt') return 'receipt';
  return 'dashboard';
}

function getReceiptRows(receipt) {
  const nextDateLabel = receipt.type === 'diagnosis' ? 'Session 1 Date' : 'Next Appointment';
  return [
    ['Patient', receipt.patient.name],
    ['CNIC', receipt.patient.cnic || ''],
    ['Contact', receipt.patient.contact || ''],
    ['Diagnosis', receipt.treatment.diagnosis],
    ['Procedure', receipt.treatment.procedure],
    ['Sessions', receipt.treatment.totalSessions],
    ['Doctor', receipt.session.doctorName || receipt.treatment.diagnosisDoctor || ''],
    ['Charges', receipt.session.charges],
    [nextDateLabel, receipt.session.nextAppointmentDate || ''],
    ['Remarks', receipt.session.remarks || receipt.treatment.diagnosisRemarks || '']
  ];
}

function renderReceiptWindowHtml(receipt) {
  const title = receipt.type === 'diagnosis' ? 'Diagnosis Receipt' : `Session ${receipt.session.sessionNumber} Receipt`;
  const rows = getReceiptRows(receipt).map(([label, value]) => `
    <div class="print-row">
      <span>${escapeHtml(label)}</span>
      <span>${escapeHtml(value ?? '')}</span>
    </div>
  `).join('');

  return `
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          @page { size: 80mm auto; margin: 4mm; }
          * { box-sizing: border-box; }
          body {
            background: #f4f7f4;
            color: #000;
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 14px;
          }
          .receipt-actions {
            display: flex;
            gap: 8px;
            margin: 0 auto 10px;
            max-width: 72mm;
          }
          button {
            border: 0;
            border-radius: 4px;
            color: #fff;
            cursor: pointer;
            flex: 1;
            font-size: 12px;
            font-weight: 700;
            padding: 8px;
          }
          button:first-child { background: #23684f; }
          button:last-child { background: #56645d; }
          .print-receipt {
            background: #fff;
            border: 1px dashed #94a39b;
            font-size: 12px;
            margin: 0 auto;
            padding: 10px;
            width: 72mm;
          }
          h1 {
            font-size: 16px;
            margin: 0 0 6px;
            text-align: center;
          }
          .print-clinic {
            font-size: 13px;
            font-weight: 700;
            text-align: center;
          }
          .print-meta {
            border-bottom: 1px dashed #000;
            margin-bottom: 8px;
            padding-bottom: 6px;
            text-align: center;
          }
          .print-row {
            display: flex;
            gap: 8px;
            justify-content: space-between;
            padding: 3px 0;
          }
          .print-row span:first-child {
            font-weight: 700;
            min-width: 26mm;
          }
          .print-row span:last-child {
            overflow-wrap: anywhere;
            text-align: right;
          }
          .print-footer {
            border-top: 1px dashed #000;
            margin-top: 8px;
            padding-top: 6px;
            text-align: center;
          }
          @media print {
            body { background: #fff; padding: 0; }
            .receipt-actions { display: none; }
            .print-receipt { border: 0; margin: 0; padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="receipt-actions">
          <button onclick="window.print()">Print Receipt</button>
          <button onclick="window.close()">Close Window</button>
        </div>
        <div class="print-receipt">
          <div class="print-clinic">Dermatology Clinic</div>
          <h1>${escapeHtml(title)}</h1>
          <div class="print-meta">${escapeHtml(new Date(receipt.printedAt).toLocaleString())}</div>
          ${rows}
          <div class="print-footer">Please bring this slip on your next visit.</div>
        </div>
      </body>
    </html>
  `;
}

function ReceiptWindowPage() {
  const [receipt, setReceipt] = useState(() => {
    const queryPayload = new URLSearchParams(window.location.search).get('payload');
    if (queryPayload) {
      try {
        return JSON.parse(decodeURIComponent(queryPayload));
      } catch {
        return null;
      }
    }

    try {
      const rawReceipt = localStorage.getItem('clinicLastReceipt');
      return rawReceipt ? JSON.parse(rawReceipt) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    function readUrlReceipt() {
      const queryPayload = new URLSearchParams(window.location.search).get('payload');
      if (!queryPayload) return false;
      try {
        setReceipt(JSON.parse(decodeURIComponent(queryPayload)));
        return true;
      } catch {
        return false;
      }
    }

    function readStoredReceipt() {
      try {
        const rawReceipt = localStorage.getItem('clinicLastReceipt');
        if (rawReceipt) {
          setReceipt(JSON.parse(rawReceipt));
          return true;
        }
      } catch {
        return false;
      }
      return false;
    }

    function handleMessage(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'clinic-receipt') {
        setReceipt(event.data.receipt);
      }
    }

    window.addEventListener('message', handleMessage);
    const receiptTimer = window.setInterval(() => {
      if (readUrlReceipt() || readStoredReceipt()) {
        window.clearInterval(receiptTimer);
      }
    }, 250);

    readUrlReceipt() || readStoredReceipt();

    return () => {
      window.removeEventListener('message', handleMessage);
      window.clearInterval(receiptTimer);
    };
  }, []);

  if (!receipt) {
    return (
      <section className="receipt-window">
        <div className="receipt-panel">
          <p className="empty-state">Waiting for receipt...</p>
        </div>
      </section>
    );
  }

  const title = receipt.type === 'diagnosis' ? 'Diagnosis Receipt' : `Session ${receipt.session.sessionNumber} Receipt`;
  return (
    <section className="receipt-window">
      <div className="receipt-panel">
        <div className="receipt-actions">
          <button type="button" onClick={() => window.print()}>Print Receipt</button>
          <button type="button" onClick={() => window.close()}>Close Window</button>
        </div>
        <div className="print-receipt">
          <div className="print-clinic">Dermatology Clinic</div>
          <h1>{title}</h1>
          <div className="print-meta">{new Date(receipt.printedAt).toLocaleString()}</div>
          {getReceiptRows(receipt).map(([label, value]) => (
            <div className="print-row" key={label}>
              <span>{label}</span>
              <span>{value}</span>
            </div>
          ))}
          <div className="print-footer">Please bring this slip on your next visit.</div>
        </div>
      </div>
    </section>
  );
}

function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function handleLogin(event) {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? 'Login failed.');
      return;
    }
    onLogin(data.user);
  }

  return (
    <main className="login-shell">
      <form className="entry-form login-form" onSubmit={handleLogin}>
        <h1>Dermatology Clinic Login</h1>
        {error && <div className="notice error">{error}</div>}
        <Field label="Username" required>
          <input value={username} onChange={(event) => setUsername(event.target.value)} required />
        </Field>
        <Field label="Password" required>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </Field>
        <div className="actions">
          <button type="submit">Login</button>
        </div>
        <p className="empty-state">Default first login: admin / admin123</p>
      </form>
    </main>
  );
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function DashboardPage({ onOpenAppointment, clinicSettings }) {
  const today = todayString();
  const pageSize = 10;
  const [appointmentMode, setAppointmentMode] = useState('future');
  const [search, setSearch] = useState('');
  const [appointments, setAppointments] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [dashboardMessage, setDashboardMessage] = useState('');
  const [dashboardError, setDashboardError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadDashboardAppointments();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [appointmentMode, search]);

  async function loadDashboardAppointments() {
    setLoading(true);
    const params = new URLSearchParams({ from: today, mode: appointmentMode, search });
    if (appointmentMode === 'today') {
      params.set('to', today);
    }
    try {
      const response = await fetch(`/api/appointments?${params}`);
      const data = await response.json();
      setAppointments(data.appointments ?? []);
      setCurrentPage(1);
    } finally {
      setLoading(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(appointments.length / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const pageAppointments = appointments.slice(pageStart, pageStart + pageSize);
  const rangeStart = appointments.length ? pageStart + 1 : 0;
  const rangeEnd = Math.min(pageStart + pageSize, appointments.length);
  const dashboardExportColumns = [
    { key: 'next_appointment_date', label: 'Date' },
    { key: 'patient_name', label: 'Patient' },
    { key: 'contact', label: 'Contact' },
    { key: 'cnic', label: 'CNIC' },
    { key: 'procedure', label: 'Procedure' },
    { key: 'diagnosis', label: 'Diagnosis' },
    { key: 'next_session_number', label: 'Session' },
    { key: 'remaining_sessions', label: 'Remaining' }
  ];
  const dashboardTitle = appointmentMode === 'today' ? 'Today Appointments' : 'Future Appointments';

  return (
    <section className="entry-form dashboard-page">
      {dashboardMessage && <div className="notice success">{dashboardMessage}</div>}
      {dashboardError && <div className="notice error">{dashboardError}</div>}
      <div className="dashboard-controls">
        <div className="dashboard-toggle" role="group" aria-label="Appointment filter">
          <button
            type="button"
            className={appointmentMode === 'today' ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setAppointmentMode('today')}
          >
            Today
          </button>
          <button
            type="button"
            className={appointmentMode === 'future' ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setAppointmentMode('future')}
          >
            Future Appointments
          </button>
        </div>
        <Field label="Search">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Patient, CNIC, contact, diagnosis, procedure" />
        </Field>
      </div>

      <div className="section-header">
        <h2>{loading ? 'Loading appointments...' : `${appointments.length} pending appointment${appointments.length === 1 ? '' : 's'}`}</h2>
        <div className="export-actions">
          <button type="button" disabled={!appointments.length} onClick={() => exportRowsToPdf(dashboardTitle, dashboardExportColumns, appointments, clinicSettings)}>
            Export PDF
          </button>
          <button type="button" disabled={!appointments.length} onClick={() => exportRowsToExcel(dashboardTitle, dashboardExportColumns, appointments, clinicSettings)}>
            Export Excel
          </button>
        </div>
      </div>

      <div className="appointment-table">
        <div className="appointment-row appointment-head">
          <span>Date</span>
          <span>Patient</span>
          <span>Contact</span>
          <span>CNIC</span>
          <span>Procedure</span>
          <span>Diagnosis</span>
          <span>Session</span>
          <span>Remaining</span>
          <span>Action</span>
        </div>
        {pageAppointments.map((appointment) => (
          <div className="appointment-row" key={appointment.treatment_id}>
            <span>{appointment.next_appointment_date}</span>
            <span>{appointment.patient_name}</span>
            <span>{appointment.contact || ''}</span>
            <span>{appointment.cnic || ''}</span>
            <span>{appointment.procedure}</span>
            <span>{appointment.diagnosis}</span>
            <span>{appointment.next_session_number}</span>
            <span>{appointment.remaining_sessions}</span>
            <span className="row-actions">
              <button type="button" onClick={() => onOpenAppointment(appointment, 'edit')}>Edit</button>
              <button type="button" onClick={() => onOpenAppointment(appointment, 'select')}>Select</button>
            </span>
          </div>
        ))}
      </div>
      <div className="pagination">
        <span>Showing {rangeStart}-{rangeEnd} of {appointments.length}</span>
        <button type="button" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => page - 1)}>Previous</button>
        <span>Page {currentPage} of {totalPages}</span>
        <button type="button" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => page + 1)}>Next</button>
      </div>
      {!appointments.length && !loading && <p className="empty-state dashboard-empty">No appointments found.</p>}
    </section>
  );
}

const reportTypes = [
  { key: 'treatments', label: 'Active / Completed' },
  { key: 'sessions', label: 'Session Report' },
  { key: 'reviews', label: 'Review Report' },
  { key: 'doctors', label: 'Doctor Performance' },
  { key: 'procedures', label: 'Procedure Report' }
];

function monthStartString() {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

function formatAmount(value) {
  const number = Number(value || 0);
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fileDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function exportRowsToExcel(title, columns, rows, clinicSettings = defaultClinicSettings) {
  const headerLines = getClinicHeaderLines(clinicSettings);
  const tableRows = rows.map((row) => `
    <tr>${columns.map((column) => `<td>${escapeHtml(row[column.key] ?? '')}</td>`).join('')}</tr>
  `).join('');
  const html = `
    <!doctype html>
    <html>
      <head><meta charset="UTF-8" /></head>
      <body>
        <table>
          <thead>
            ${headerLines.map((line) => `<tr><th colspan="${columns.length}">${escapeHtml(line)}</th></tr>`).join('')}
            <tr><th colspan="${columns.length}">${escapeHtml(title)}</th></tr>
            <tr><th colspan="${columns.length}">Exported ${escapeHtml(new Date().toLocaleString())}</th></tr>
            <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${fileDateStamp()}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function exportRowsToPdf(title, columns, rows, clinicSettings = defaultClinicSettings) {
  const headerLines = getClinicHeaderLines(clinicSettings);
  const tableRows = rows.map((row) => `
    <tr>${columns.map((column) => `<td>${escapeHtml(row[column.key] ?? '')}</td>`).join('')}</tr>
  `).join('');
  const printWindow = window.open('', 'clinic-export-pdf', 'width=1100,height=800');
  if (!printWindow) return;
  printWindow.document.open();
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 24px; color: #111; }
          .actions { display: flex; gap: 8px; justify-content: flex-end; margin-bottom: 16px; }
          button { background: #23684f; border: 0; color: #fff; cursor: pointer; font-weight: 700; padding: 10px 14px; }
          .clinic-name { font-size: 24px; font-weight: 800; margin-bottom: 4px; text-align: center; }
          .clinic-detail { font-size: 12px; margin-bottom: 3px; text-align: center; }
          h1 { font-size: 20px; margin: 0 0 4px; text-align: center; }
          .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
          table { border-collapse: collapse; font-size: 11px; width: 100%; }
          th, td { border: 1px solid #999; padding: 6px; text-align: left; vertical-align: top; word-break: break-word; }
          th { background: #eef5f1; }
          @media print {
            .actions { display: none; }
            body { margin: 10mm; }
          }
        </style>
      </head>
      <body>
        <div class="actions">
          <button onclick="window.print()">Print / Save PDF</button>
          <button onclick="window.close()">Close</button>
        </div>
        <div class="clinic-name">${escapeHtml(headerLines[0])}</div>
        ${headerLines.slice(1).map((line) => `<div class="clinic-detail">${escapeHtml(line)}</div>`).join('')}
        <h1>${escapeHtml(title)}</h1>
        <div class="meta">Exported ${escapeHtml(new Date().toLocaleString())}</div>
        <table>
          <thead><tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
}

function getClinicHeaderLines(settings = defaultClinicSettings) {
  const lines = [settings.clinic_name || defaultClinicSettings.clinic_name];
  if (settings.contact) lines.push(`Contact: ${settings.contact}`);
  if (settings.email) lines.push(`Email: ${settings.email}`);
  if (settings.address) lines.push(settings.address);
  return lines;
}

function ReportsPage({ procedures, clinicSettings }) {
  const [reportType, setReportType] = useState('treatments');
  const [filters, setFilters] = useState({
    from: monthStartString(),
    to: todayString(),
    procedure: '',
    doctor: '',
    status: 'all'
  });
  const [rows, setRows] = useState([]);
  const [reportDoctors, setReportDoctors] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [reportError, setReportError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadReport();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [reportType, filters.from, filters.to, filters.procedure, filters.doctor, filters.status]);

  useEffect(() => {
    if (reportType !== 'treatments') return;
    const controller = new AbortController();
    fetch('/api/doctors?search=', { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => setReportDoctors(data.doctors ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [reportType]);

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  async function loadReport() {
    setLoading(true);
    setReportError('');
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.procedure && ['treatments', 'sessions', 'reviews'].includes(reportType)) {
      params.set('procedure', filters.procedure);
    }
    if (reportType === 'treatments') {
      params.set('status', filters.status);
      if (filters.doctor) params.set('doctor', filters.doctor);
    }

    try {
      const response = await fetch(`/api/reports/${reportType}?${params}`);
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Reports API is not available. Restart the local server and refresh the page.');
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to load report.');
      setRows(data.rows ?? []);
      setCount(data.count ?? 0);
    } catch (error) {
      setRows([]);
      setCount(0);
      setReportError(error.message);
    } finally {
      setLoading(false);
    }
  }

  const exportConfig = getReportExportConfig(reportType, rows);

  return (
    <section className="entry-form reports-page">
      {reportError && <div className="notice error">{reportError}</div>}
      <div className="report-tabs" role="group" aria-label="Reports">
        {reportTypes.map((type) => (
          <button
            type="button"
            key={type.key}
            className={reportType === type.key ? 'toggle-button active' : 'toggle-button'}
            onClick={() => setReportType(type.key)}
          >
            {type.label}
          </button>
        ))}
      </div>

      <div className="report-filters">
        <Field label="From">
          <input type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} />
        </Field>
        {['treatments', 'sessions', 'reviews'].includes(reportType) && (
          <Field label="Procedure">
            <select value={filters.procedure} onChange={(event) => updateFilter('procedure', event.target.value)}>
              <option value="">All procedures</option>
              {procedures.map((procedure) => (
                <option key={procedure.id} value={procedure.name}>{procedure.name}</option>
              ))}
            </select>
          </Field>
        )}
        {reportType === 'treatments' && (
          <>
            <Field label="Doctor">
              <select value={filters.doctor} onChange={(event) => updateFilter('doctor', event.target.value)}>
                <option value="">All doctors</option>
                {reportDoctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.name}>{doctor.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </Field>
          </>
        )}
      </div>

      <div className="section-header">
        <h2>{loading ? 'Loading report...' : `${count} record${count === 1 ? '' : 's'}`}</h2>
        <div className="export-actions">
          <button type="button" onClick={loadReport}>Refresh</button>
          <button
            type="button"
            disabled={!rows.length}
            onClick={() => exportRowsToPdf(exportConfig.title, exportConfig.columns, exportConfig.rows, clinicSettings)}
          >
            Export PDF
          </button>
          <button
            type="button"
            disabled={!rows.length}
            onClick={() => exportRowsToExcel(exportConfig.title, exportConfig.columns, exportConfig.rows, clinicSettings)}
          >
            Export Excel
          </button>
        </div>
      </div>

      <ReportTable type={reportType} rows={rows} />
      {!rows.length && !loading && <p className="empty-state dashboard-empty">No report records found.</p>}
    </section>
  );
}

function getReportExportConfig(type, rows) {
  if (type === 'sessions') {
    return {
      title: 'Session Report',
      columns: [
        { key: 'visit_date', label: 'Visit' },
        { key: 'patient_name', label: 'Patient' },
        { key: 'contact', label: 'Contact' },
        { key: 'procedure', label: 'Procedure' },
        { key: 'diagnosis', label: 'Diagnosis' },
        { key: 'session', label: 'Session' },
        { key: 'doctor_name', label: 'Doctor' },
        { key: 'charges', label: 'Charges' },
        { key: 'next_appointment_date', label: 'Next Date' },
        { key: 'remarks', label: 'Remarks' }
      ],
      rows: rows.map((row) => ({
        ...row,
        session: `${row.session_number}/${row.total_sessions}`,
        doctor_name: row.doctor_name || 'Not set',
        charges: formatAmount(row.charges)
      }))
    };
  }

  if (type === 'reviews') {
    return {
      title: 'Review Report',
      columns: [
        { key: 'review_date', label: 'Date' },
        { key: 'review_type', label: 'Type' },
        { key: 'patient_name', label: 'Patient' },
        { key: 'procedure', label: 'Procedure' },
        { key: 'diagnosis', label: 'Diagnosis' },
        { key: 'session_number', label: 'Session' },
        { key: 'doctor_name', label: 'Doctor' },
        { key: 'remarks', label: 'Remarks' }
      ],
      rows: rows.map((row) => ({ ...row, doctor_name: row.doctor_name || 'Not set' }))
    };
  }

  if (type === 'doctors') {
    return {
      title: 'Doctor Performance Report',
      columns: [
        { key: 'doctor_name', label: 'Doctor' },
        { key: 'sessions_done', label: 'Sessions' },
        { key: 'patients_seen', label: 'Patients' },
        { key: 'treatments_seen', label: 'Treatments' },
        { key: 'session_charges', label: 'Session Charges' }
      ],
      rows: rows.map((row) => ({ ...row, session_charges: formatAmount(row.session_charges) }))
    };
  }

  if (type === 'procedures') {
    return {
      title: 'Procedure Report',
      columns: [
        { key: 'procedure', label: 'Procedure' },
        { key: 'treatment_count', label: 'Treatments' },
        { key: 'active_count', label: 'Active' },
        { key: 'completed_count', label: 'Completed' },
        { key: 'planned_sessions', label: 'Planned Sessions' },
        { key: 'completed_sessions', label: 'Done Sessions' },
        { key: 'treatment_charges', label: 'Treatment Charges' },
        { key: 'session_charges', label: 'Session Charges' }
      ],
      rows: rows.map((row) => ({
        ...row,
        treatment_charges: formatAmount(row.treatment_charges),
        session_charges: formatAmount(row.session_charges)
      }))
    };
  }

  return {
    title: 'Active Completed Treatment Report',
    columns: [
      { key: 'started_at', label: 'Start' },
      { key: 'status', label: 'Status' },
      { key: 'patient_name', label: 'Patient' },
      { key: 'contact', label: 'Contact' },
      { key: 'procedure', label: 'Procedure' },
      { key: 'diagnosis', label: 'Diagnosis' },
      { key: 'sessions', label: 'Sessions' },
      { key: 'remaining_sessions', label: 'Remaining' },
      { key: 'doctor_name', label: 'Doctor' },
      { key: 'next_appointment_date', label: 'Next Date' },
      { key: 'charges', label: 'Charges' }
    ],
    rows: rows.map((row) => ({
      ...row,
      sessions: `${row.completed_sessions}/${row.total_sessions}`,
      doctor_name: row.doctor_name || 'Not set',
      charges: formatAmount(row.charges)
    }))
  };
}

function ReportTable({ type, rows }) {
  if (type === 'sessions') {
    return (
      <div className="report-table report-sessions">
        <ReportHead columns={['Visit', 'Patient', 'Contact', 'Procedure', 'Diagnosis', 'Session', 'Doctor', 'Charges', 'Next Date', 'Remarks']} />
        {rows.map((row) => (
          <div className="report-row" key={row.session_id}>
            <span>{row.visit_date}</span>
            <span>{row.patient_name}</span>
            <span>{row.contact || ''}</span>
            <span>{row.procedure}</span>
            <span>{row.diagnosis}</span>
            <span>{row.session_number}/{row.total_sessions}</span>
            <span>{row.doctor_name || 'Not set'}</span>
            <span>{formatAmount(row.charges)}</span>
            <span>{row.next_appointment_date || ''}</span>
            <span>{row.remarks || ''}</span>
          </div>
        ))}
      </div>
    );
  }

  if (type === 'reviews') {
    return (
      <div className="report-table report-reviews">
        <ReportHead columns={['Date', 'Type', 'Patient', 'Procedure', 'Diagnosis', 'Session', 'Doctor', 'Remarks']} />
        {rows.map((row, index) => (
          <div className="report-row" key={`${row.review_type}-${row.treatment_id}-${row.session_number ?? 0}-${index}`}>
            <span>{row.review_date}</span>
            <span>{row.review_type}</span>
            <span>{row.patient_name}</span>
            <span>{row.procedure}</span>
            <span>{row.diagnosis}</span>
            <span>{row.session_number || ''}</span>
            <span>{row.doctor_name || 'Not set'}</span>
            <span>{row.remarks}</span>
          </div>
        ))}
      </div>
    );
  }

  if (type === 'doctors') {
    return (
      <div className="report-table report-doctors">
        <ReportHead columns={['Doctor', 'Sessions', 'Patients', 'Treatments', 'Session Charges']} />
        {rows.map((row) => (
          <div className="report-row" key={row.doctor_name}>
            <span>{row.doctor_name}</span>
            <span>{row.sessions_done}</span>
            <span>{row.patients_seen}</span>
            <span>{row.treatments_seen}</span>
            <span>{formatAmount(row.session_charges)}</span>
          </div>
        ))}
      </div>
    );
  }

  if (type === 'procedures') {
    return (
      <div className="report-table report-procedures">
        <ReportHead columns={['Procedure', 'Treatments', 'Active', 'Completed', 'Planned Sessions', 'Done Sessions', 'Treatment Charges', 'Session Charges']} />
        {rows.map((row) => (
          <div className="report-row" key={row.procedure}>
            <span>{row.procedure}</span>
            <span>{row.treatment_count}</span>
            <span>{row.active_count}</span>
            <span>{row.completed_count}</span>
            <span>{row.planned_sessions}</span>
            <span>{row.completed_sessions}</span>
            <span>{formatAmount(row.treatment_charges)}</span>
            <span>{formatAmount(row.session_charges)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="report-table report-treatments">
      <ReportHead columns={['Start', 'Status', 'Patient', 'Contact', 'Procedure', 'Diagnosis', 'Sessions', 'Remaining', 'Doctor', 'Next Date', 'Charges']} />
      {rows.map((row) => (
        <div className="report-row" key={row.treatment_id}>
          <span>{row.started_at}</span>
          <span>{row.status}</span>
          <span>{row.patient_name}</span>
          <span>{row.contact || ''}</span>
          <span>{row.procedure}</span>
          <span>{row.diagnosis}</span>
          <span>{row.completed_sessions}/{row.total_sessions}</span>
          <span>{row.remaining_sessions}</span>
          <span>{row.doctor_name || 'Not set'}</span>
          <span>{row.next_appointment_date || ''}</span>
          <span>{formatAmount(row.charges)}</span>
        </div>
      ))}
    </div>
  );
}

function ReportHead({ columns }) {
  return (
    <div className="report-row report-head">
      {columns.map((column) => <span key={column}>{column}</span>)}
    </div>
  );
}

function SettingsPage({ clinicSettings, setClinicSettings }) {
  const [form, setForm] = useState(() => ({
    clinicName: clinicSettings.clinic_name || defaultClinicSettings.clinic_name,
    contact: clinicSettings.contact || '',
    email: clinicSettings.email || '',
    address: clinicSettings.address || ''
  }));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setForm({
      clinicName: clinicSettings.clinic_name || defaultClinicSettings.clinic_name,
      contact: clinicSettings.contact || '',
      email: clinicSettings.email || '',
      address: clinicSettings.address || ''
    });
  }, [clinicSettings]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveSettings(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    const response = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? 'Unable to save settings.');
      return;
    }
    setClinicSettings({
      ...defaultClinicSettings,
      ...(data.settings ?? {})
    });
    setMessage('Clinic settings saved.');
  }

  return (
    <section className="entry-form settings-page">
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice error">{error}</div>}
      <form onSubmit={saveSettings}>
        <fieldset>
          <legend>Clinic Info</legend>
          <div className="form-grid">
            <Field label="Clinic Name" required>
              <input value={form.clinicName} onChange={(event) => updateForm('clinicName', event.target.value)} required />
            </Field>
            <Field label="Contact">
              <input value={form.contact} onChange={(event) => updateForm('contact', event.target.value)} placeholder="Phone or mobile number" />
            </Field>
            <Field label="Email">
              <input type="email" value={form.email} onChange={(event) => updateForm('email', event.target.value)} placeholder="clinic@example.com" />
            </Field>
            <Field label="Address" wide>
              <textarea value={form.address} onChange={(event) => updateForm('address', event.target.value)} rows="3" />
            </Field>
          </div>
        </fieldset>
        <div className="actions">
          <button type="submit">Save Settings</button>
        </div>
      </form>
    </section>
  );
}

function UsersPage() {
  const emptyUser = { id: '', name: '', username: '', password: '', role: 'staff', active: true };
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(emptyUser);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    const response = await fetch('/api/users');
    const data = await response.json();
    if (response.ok) setUsers(data.users ?? []);
  }

  function editUser(user) {
    setForm({
      id: user.id,
      name: user.name,
      username: user.username,
      password: '',
      role: user.role,
      active: Boolean(user.active)
    });
    setMessage('');
    setError('');
  }

  async function saveUser(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    const response = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? 'Unable to save user.');
      return;
    }
    setMessage('User saved.');
    setForm(emptyUser);
    await loadUsers();
  }

  return (
    <section className="management-layout">
      {message && <div className="notice success">{message}</div>}
      {error && <div className="notice error">{error}</div>}
      <section className="entry-form">
        <legend>{form.id ? 'Edit User' : 'Add User'}</legend>
        <form className="form-grid" onSubmit={saveUser}>
          <Field label="Name" required>
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
          </Field>
          <Field label="Username" required>
            <input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} required />
          </Field>
          <Field label={form.id ? 'New Password' : 'Password'} required={!form.id}>
            <input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} required={!form.id} />
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}>
              <option value="staff">Staff</option>
              <option value="admin">Admin</option>
            </select>
          </Field>
          <label className="checkbox-field">
            <input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} />
            <span>Active</span>
          </label>
          <div className="actions compact-actions">
            <button type="submit">{form.id ? 'Update User' : 'Add User'}</button>
            {form.id && <button type="button" onClick={() => setForm(emptyUser)}>Cancel</button>}
          </div>
        </form>
      </section>

      <section className="entry-form">
        <div className="section-header">
          <h2>User List</h2>
          <a className="button-link" href="/api/backup">Take Backup</a>
        </div>
        <div className="user-table">
          <div className="user-row user-head">
            <span>Name</span>
            <span>Username</span>
            <span>Role</span>
            <span>Status</span>
            <span>Action</span>
          </div>
          {users.map((user) => (
            <div className="user-row" key={user.id}>
              <span>{user.name}</span>
              <span>{user.username}</span>
              <span>{user.role}</span>
              <span>{user.active ? 'Active' : 'Inactive'}</span>
              <span><button type="button" onClick={() => editUser(user)}>Edit</button></span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}

function SameDateAppointmentsPanel({ date, appointments }) {
  return (
    <aside className="same-date-panel">
      <h2>Same Date Patients</h2>
      <div className="panel-date">{date || 'Select next appointment date'}</div>
      {date && appointments.length ? (
        <div className="same-date-list">
          {appointments.map((appointment) => (
            <div className="same-date-item" key={appointment.treatment_id}>
              <strong>{appointment.patient_name}</strong>
              <span>{appointment.contact || 'No contact'}</span>
              <span>{appointment.cnic || 'No CNIC'}</span>
              <span>{appointment.procedure}</span>
              <span>Session {appointment.next_session_number}, {appointment.remaining_sessions} remaining</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">{date ? 'No patients scheduled on this date.' : 'Patients will appear here.'}</p>
      )}
    </aside>
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ProcedurePage({ newProcedureName, procedures, setNewProcedureName, handleAddProcedure }) {
  return (
    <section className="management-layout">
      <form className="entry-form procedure-form" onSubmit={handleAddProcedure}>
        <fieldset>
          <legend>Add Procedure</legend>
          <div className="inline-form">
            <label className="field">
              <span>Procedure Name</span>
              <input
                value={newProcedureName}
                onChange={(e) => setNewProcedureName(e.target.value)}
                placeholder="e.g. Chemical peel"
                required
              />
            </label>
            <button type="submit">Add Procedure</button>
          </div>
        </fieldset>
      </form>

      <section className="entry-form procedure-list-section">
        <h2>Procedure List</h2>
        {procedures.length ? (
          <div className="procedure-list">
            {procedures.map((procedure) => (
              <div className="procedure-row" key={procedure.id}>
                <span>{procedure.name}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">No procedures added yet.</p>
        )}
      </section>
    </section>
  );
}

function TreatmentSummary({ treatment }) {
  const nextSession = Number(treatment.completed_sessions) + 1;
  const items = [
    ['Diagnosis', treatment.diagnosis],
    ['Procedure', treatment.procedure],
    ['Sessions', `${treatment.completed_sessions}/${treatment.total_sessions}`],
    ['Remaining', treatment.remaining_sessions],
    ['Doctor', treatment.doctor_name || 'Not set'],
    ['Next', `Session ${nextSession}${treatment.next_appointment_date ? ` - ${treatment.next_appointment_date}` : ''}`],
    ['Charges', treatment.charges],
    ['Remarks', treatment.remarks || '']
  ];
  const sessions = treatment.sessions ?? [];

  return (
    <section className="treatment-summary">
      <h2>Active Treatment</h2>
      <div className="summary-compact">
        {items.map(([label, value]) => (
          <div className="summary-tile" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="session-history">
        <h3>Session Details</h3>
        {sessions.length ? (
          <div className="session-table" role="table" aria-label="Session details">
            <div className="session-row session-head" role="row">
              <span>Session</span>
              <span>Visit Date</span>
              <span>Doctor</span>
              <span>Charges</span>
              <span>Next Date</span>
              <span>Remarks</span>
            </div>
            {sessions.map((session) => (
              <div className="session-row" role="row" key={session.id}>
                <span>{session.session_number}</span>
                <span>{session.visit_date}</span>
                <span>{session.doctor_name || 'Not set'}</span>
                <span>{session.charges}</span>
                <span>{session.next_appointment_date || 'Not set'}</span>
                <span>{session.remarks || ''}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">No sessions recorded yet.</p>
        )}
      </div>
    </section>
  );
}

function StatusItem({ label, value }) {
  return (
    <div className="status-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({ label, children, required = false, wide = false }) {
  return (
    <label className={wide ? 'field wide' : 'field'}>
      <span>{label}{required ? ' *' : ''}</span>
      {children}
    </label>
  );
}

createRoot(document.getElementById('root')).render(<App />);
