# DermaApp

DermaApp is a localhost-only dermatology clinic appointment and treatment management app. It is built for a single clinic machine, stores data locally in SQLite, and does not require cloud hosting.

## Features

- Patient lookup by CNIC or contact number
- CNIC input masking
- Diagnosis and treatment entry
- Session tracking with next appointment dates
- Same-date appointment patient list
- Procedure management
- Doctor management through saved doctor names
- Dashboard for pending today and future appointments
- User login and user management
- Clinic settings for clinic name, contact, email, and address
- Reports for treatments, sessions, reviews, doctors, and procedures
- PDF and Excel export for dashboard and reports
- Manual database backup button
- Automatic database backup once per day when the app starts

## Tech Stack

- Node.js
- Express
- SQLite
- React
- Vite

The React frontend builds into static public files in `client/dist`, and the Express server serves those files locally.

## Requirements

- Node.js 22 or newer
- npm

## Install

```powershell
npm install
```

## Run Locally

```powershell
npm start
```

Then open:

```text
http://127.0.0.1:3000
```

You can also use:

```powershell
.\start-clinic-app.bat
```

## Default Login

```text
Username: admin
Password: admin123
```

Change or add users from the **Users** page after logging in.

## Build

```powershell
npm run build
```

The production frontend is generated in:

```text
client/dist
```

The local Express server serves this built frontend along with the API routes.

## Data Storage

The SQLite database is stored locally at:

```text
data/clinic.sqlite
```

This file is ignored by Git so patient and clinic data are not committed.

## Backups

Manual backup:

- Click the **Backup** button in the top navigation.
- It downloads the current SQLite database.

Automatic startup backup:

- Every time the app starts, it creates one backup for the current date.
- Backups are saved in:

```text
backups/
```

Example:

```text
backups/clinic-backup-2026-05-20.sqlite
```

If a backup for the current date already exists, the app does not create a duplicate.

## Reports

Available reports:

- Active / Completed treatment report
- Session report
- Review report
- Doctor performance report
- Procedure report

Reports support filters such as date range, procedure, doctor, and status depending on the report type. Dashboard and reports can be exported to PDF or Excel.

## Tests

```powershell
npm test
```

## Notes

- This app is designed to run on localhost.
- No cloud sync or public hosting is required.
- Keep regular backups of `data/clinic.sqlite`.
