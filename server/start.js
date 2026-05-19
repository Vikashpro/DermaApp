import { createApp } from './index.js';
import { backupDatabaseOnStart, openDatabase } from './database.js';

const port = Number(process.env.PORT ?? 3000);
const db = openDatabase();
const app = createApp(db);
const backup = backupDatabaseOnStart();

app.listen(port, '127.0.0.1', () => {
  console.log(`Dermatology appointment app running at http://127.0.0.1:${port}`);
  console.log(backup.created ? `Startup backup created: ${backup.backupPath}` : `Startup backup already exists: ${backup.backupPath}`);
});
