import { exec, spawn } from 'child_process';
import { env as processEnv } from 'process';
import fs from 'fs';
import path from 'path';
import { pool } from '../config/db.js';
import { uploadToGoogleDrive, deleteFromGoogleDrive } from './googleDriveHelper.js';

/*
 * School-scoped backup service
 *
 * Important rules:
 * - A school backup MUST always receive a valid schoolId.
 * - Only modules and permissions are exported as global reference data.
 * - Platform administration tables and backup settings are never exported
 *   inside a school backup.
 * - The full-platform pg_dump remains a separate explicit operation.
 */

const GLOBAL_REFERENCE_TABLES = new Set([
  'modules',
  'permissions'
]);

const PLATFORM_PROTECTED_TABLES = new Set([
  'platform_activity_logs',
  'platform_admins',
  'schools_master_registry',
  'global_system_logs',
  'backup_logs',
  'backup_settings'
]);

const SCHOOL_TABLES_TO_SKIP = new Set([
  'backup_logs',
  'backup_settings'
]);

function requireValidSchoolId(rawSchoolId) {
  const schoolId = Number(rawSchoolId);

  if (!Number.isSafeInteger(schoolId) || schoolId <= 0) {
    throw new Error('A valid schoolId is required for a school backup');
  }

  return schoolId;
}

function escapeSqlLiteral(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

export function getDbConnectionParams() {
  const dbUrl = process.env.DATABASE_URL;

  if (dbUrl) {
    try {
      const parsed = new URL(dbUrl);

      return {
        host: parsed.hostname,
        port: parsed.port || '5432',
        user: parsed.username,
        password: decodeURIComponent(parsed.password || ''),
        database: parsed.pathname.replace(/^\//, '')
      };
    } catch (error) {
      console.warn('Failed to parse DATABASE_URL', error.message);
    }
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || '5432',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'school_system'
  };
}

export function resolveBackupPath(configuredPath, schoolId) {
  const basePath = configuredPath ? configuredPath.trim() : 'backups';
  const resolved = path.isAbsolute(basePath)
    ? basePath
    : path.resolve(process.cwd(), basePath);

  return path.join(resolved, `school_${schoolId}`);
}

function formatSqlValue(value, udtName, dataType) {
  if (value === null || value === undefined) return 'NULL';

  const type = String(udtName || dataType || '').toLowerCase();

  if (type === 'bool' || type === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }

  if (
    [
      'int2',
      'int4',
      'int8',
      'serial',
      'bigserial',
      'smallserial',
      'oid'
    ].includes(type)
  ) {
    return value.toString();
  }

  if (
    [
      'float4',
      'float8',
      'numeric',
      'decimal',
      'real',
      'double precision'
    ].includes(type)
  ) {
    return value.toString();
  }

  if (type === 'money') {
    return `E'${escapeSqlLiteral(value)}'::money`;
  }

  if (type === 'bytea') {
    const buffer = Buffer.isBuffer(value)
      ? value
      : Buffer.from(value);

    return `'\\x${buffer.toString('hex')}'::bytea`;
  }

  if (type === 'uuid') {
    return `E'${escapeSqlLiteral(value)}'::uuid`;
  }

  if (type === 'json' || type === 'jsonb') {
    return `E'${escapeSqlLiteral(JSON.stringify(value))}'::${type}`;
  }

  if (type.startsWith('_')) {
    const elementType = type.substring(1);

    if (!Array.isArray(value)) return 'NULL';

    const values = value.map((item) => {
      if (item === null || item === undefined) return 'NULL';
      if (typeof item === 'boolean') return item ? 'TRUE' : 'FALSE';
      if (typeof item === 'number') return item.toString();

      return `E'${escapeSqlLiteral(item)}'`;
    });

    return `ARRAY[${values.join(', ')}]::${elementType}[]`;
  }

  if (value instanceof Date) {
    return `E'${escapeSqlLiteral(value.toISOString())}'::timestamptz`;
  }

  if (Buffer.isBuffer(value)) {
    return `'\\x${value.toString('hex')}'::bytea`;
  }

  return `E'${escapeSqlLiteral(value)}'`;
}

async function getTableColumns(client, tableName) {
  const { rows } = await client.query(
    `
      SELECT column_name, udt_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [tableName]
  );

  return rows;
}

// Export trusted global reference data only.
async function exportFullTableData(client, tableName, outputStream) {
  const columns = await getTableColumns(client, tableName);

  if (columns.length === 0) return;

  const { rows: data } = await client.query(
    `SELECT * FROM "${tableName}"`
  );

  outputStream.write(`\n-- Global reference table: ${tableName}\n`);

  if (data.length === 0) {
    outputStream.write(`-- No data in ${tableName}\n`);
    return;
  }

  const columnNames = columns
    .map((column) => `"${column.column_name}"`)
    .join(', ');

  for (const row of data) {
    const values = columns.map((column) =>
      formatSqlValue(
        row[column.column_name],
        column.udt_name,
        column.data_type
      )
    );

    outputStream.write(
      `INSERT INTO "${tableName}" (${columnNames}) VALUES (${values.join(', ')}) ON CONFLICT DO NOTHING;\n`
    );
  }
}

// Export rows belonging to one school only.
async function exportSchoolTableData(
  client,
  tableName,
  schoolId,
  outputStream
) {
  const columns = await getTableColumns(client, tableName);

  if (columns.length === 0) return;

  const { rows: data } = await client.query(
    `SELECT * FROM "${tableName}" WHERE school_id = $1`,
    [schoolId]
  );

  outputStream.write(
    `\n-- School table: ${tableName} (school_id = ${schoolId})\n`
  );

  outputStream.write(
    `DELETE FROM "${tableName}" WHERE school_id = ${schoolId};\n`
  );

  if (data.length === 0) {
    outputStream.write(`-- No data for school ${schoolId}\n`);
    return;
  }

  const columnNames = columns
    .map((column) => `"${column.column_name}"`)
    .join(', ');

  for (const row of data) {
    const values = columns.map((column) =>
      formatSqlValue(
        row[column.column_name],
        column.udt_name,
        column.data_type
      )
    );

    outputStream.write(
      `INSERT INTO "${tableName}" (${columnNames}) VALUES (${values.join(', ')});\n`
    );
  }
}

// Export only the selected school row. Do not delete the school record.
// Upsert is safer than deleting the parent row.
async function exportSingleSchoolRow(client, schoolId, outputStream) {
  const tableName = 'schools';
  const columns = await getTableColumns(client, tableName);

  if (columns.length === 0) return;

  const { rows: data } = await client.query(
    `SELECT * FROM "schools" WHERE id = $1`,
    [schoolId]
  );

  if (data.length === 0) {
    throw new Error(`School #${schoolId} does not exist`);
  }

  const columnNames = columns
    .map((column) => `"${column.column_name}"`)
    .join(', ');

  const updateAssignments = columns
    .filter((column) => column.column_name !== 'id')
    .map(
      (column) =>
        `"${column.column_name}" = EXCLUDED."${column.column_name}"`
    )
    .join(', ');

  outputStream.write(
    `\n-- Current school row only: schools (id = ${schoolId})\n`
  );

  for (const row of data) {
    const values = columns.map((column) =>
      formatSqlValue(
        row[column.column_name],
        column.udt_name,
        column.data_type
      )
    );

    const conflictAction = updateAssignments
      ? `DO UPDATE SET ${updateAssignments}`
      : 'DO NOTHING';

    outputStream.write(
      `INSERT INTO "schools" (${columnNames}) VALUES (${values.join(', ')}) ON CONFLICT ("id") ${conflictAction};\n`
    );
  }
}

// Sequences are global for the table, not per school.
// Always use MAX() from the complete table to avoid duplicate IDs.
async function updateSequence(client, tableName, outputStream) {
  const { rows: sequences } = await client.query(
    `
      SELECT
        pg_get_serial_sequence(
          format('%I.%I', c.table_schema, c.table_name),
          c.column_name
        ) AS seq_name,
        c.column_name
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = $1
        AND pg_get_serial_sequence(
          format('%I.%I', c.table_schema, c.table_name),
          c.column_name
        ) IS NOT NULL
    `,
    [tableName]
  );

  for (const sequence of sequences) {
    const escapedSequenceName = escapeSqlLiteral(sequence.seq_name);

    outputStream.write(
      `SELECT setval(E'${escapedSequenceName}', COALESCE((SELECT MAX("${sequence.column_name}") FROM "${tableName}"), 1), EXISTS(SELECT 1 FROM "${tableName}"));\n`
    );
  }
}

async function waitForStreamFinish(outputStream) {
  return new Promise((resolve, reject) => {
    outputStream.once('finish', resolve);
    outputStream.once('error', reject);
  });
}

// Creates a backup for ONE school only.
export async function runPgDump(outputPath, rawSchoolId) {
  const schoolId = requireValidSchoolId(rawSchoolId);
  const directory = path.dirname(outputPath);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const outputStream = fs.createWriteStream(outputPath);
  const client = await pool.connect();

  try {
    const schoolResult = await client.query(
      `SELECT id FROM schools WHERE id = $1`,
      [schoolId]
    );

    if (schoolResult.rowCount === 0) {
      throw new Error(`School #${schoolId} does not exist`);
    }

    outputStream.write(`\\set ON_ERROR_STOP on\n`);
    outputStream.write(`-- School Backup for school_id: ${schoolId}\n`);
    outputStream.write(`-- Generated: ${new Date().toISOString()}\n`);
    outputStream.write(
      `-- This file contains data for school_id=${schoolId} only.\n\n`
    );

    outputStream.write(`BEGIN;\n`);
    outputStream.write(
      `SET LOCAL session_replication_role = 'replica';\n\n`
    );

    // Tables without school_id must be classified explicitly.
    const { rows: sharedTables } = await client.query(
      `
        SELECT table_name
        FROM information_schema.tables t
        WHERE t.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
          AND NOT EXISTS (
            SELECT 1
            FROM information_schema.columns c
            WHERE c.table_schema = t.table_schema
              AND c.table_name = t.table_name
              AND c.column_name = 'school_id'
          )
        ORDER BY table_name
      `
    );

    outputStream.write(`-- ===== GLOBAL AND FILTERED DATA =====\n`);

    for (const { table_name: tableName } of sharedTables) {
      if (PLATFORM_PROTECTED_TABLES.has(tableName)) {
        outputStream.write(
          `\n-- Table ${tableName} skipped (platform protected data)\n`
        );
        continue;
      }

      if (tableName === 'schools') {
        await exportSingleSchoolRow(client, schoolId, outputStream);
        continue;
      }

      if (GLOBAL_REFERENCE_TABLES.has(tableName)) {
        await exportFullTableData(client, tableName, outputStream);
        continue;
      }

      throw new Error(
        `Unsafe backup configuration: table "${tableName}" has no school_id and is not classified`
      );
    }

    // Every tenant-owned table now has school_id.
    const { rows: schoolTables } = await client.query(
      `
        SELECT DISTINCT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'school_id'
        ORDER BY table_name
      `
    );

    outputStream.write(`\n\n-- ===== SCHOOL ${schoolId} DATA =====\n`);

    const exportedSchoolTables = [];

    for (const { table_name: tableName } of schoolTables) {
      if (SCHOOL_TABLES_TO_SKIP.has(tableName)) {
        outputStream.write(
          `\n-- Table ${tableName} skipped (backup metadata or secrets)\n`
        );
        continue;
      }

      await exportSchoolTableData(
        client,
        tableName,
        schoolId,
        outputStream
      );

      exportedSchoolTables.push(tableName);
    }

    outputStream.write(`\n\n-- ===== GLOBAL SEQUENCES =====\n`);

    const sequenceTables = new Set([
      'schools',
      ...GLOBAL_REFERENCE_TABLES,
      ...exportedSchoolTables
    ]);

    for (const tableName of sequenceTables) {
      await updateSequence(client, tableName, outputStream);
    }

    outputStream.write(
      `\nSET LOCAL session_replication_role = 'origin';\n`
    );
    outputStream.write(`COMMIT;\n`);
    outputStream.write(
      `\n-- Backup completed for school ${schoolId}\n`
    );

    outputStream.end();
    await waitForStreamFinish(outputStream);

    return {
      success: true,
      path: outputPath,
      schoolId
    };
  } catch (error) {
    outputStream.destroy();

    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
      } catch {
        // Ignore cleanup failure and report the original error.
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

// Explicit platform-wide backup. Never call this as a fallback
// when schoolId is missing.
export async function runFullPlatformPgDump(outputPath) {
  const params = getDbConnectionParams();
  const directory = path.dirname(outputPath);

  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const pgDumpCommand =
    `pg_dump -h "${params.host}" ` +
    `-p "${params.port}" ` +
    `-U "${params.user}" ` +
    `-d "${params.database}" ` +
    `-F p -b -v -f "${outputPath}"`;

  return new Promise((resolve, reject) => {
    const options = {
      env: {
        ...processEnv,
        PGPASSWORD: params.password
      }
    };

    exec(pgDumpCommand, options, (error, stdout, stderr) => {
      if (!error) {
        resolve({ stdout, stderr });
        return;
      }

      console.warn(
        `Direct pg_dump failed: ${error.message}. Trying docker...`
      );

      const fileStream = fs.createWriteStream(outputPath);

      const child = spawn('docker', [
        'exec',
        '-i',
        'smart-school-postgres',
        'pg_dump',
        '-U',
        params.user || 'postgres',
        '-d',
        params.database || 'school_system'
      ]);

      child.stdout.pipe(fileStream);

      let spawnError = '';

      child.stderr.on('data', (data) => {
        spawnError += data.toString();
      });

      child.on('error', reject);

      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            stdout: 'Docker backup complete',
            stderr: spawnError
          });
        } else {
          reject(
            new Error(`Docker backup failed: ${spawnError}`)
          );
        }
      });
    });
  });
}

export async function cleanOldBackups(rawSchoolId, keepCount) {
  const schoolId = requireValidSchoolId(rawSchoolId);

  if (!keepCount || keepCount <= 0) return;

  try {
    const { rows } = await pool.query(
      `
        SELECT
          id,
          backup_path,
          google_drive_file_id
        FROM backup_logs
        WHERE school_id = $1
          AND status = 'success'
        ORDER BY created_at ASC
      `,
      [schoolId]
    );

    if (rows.length <= keepCount) return;

    const backupsToDelete = rows.slice(
      0,
      rows.length - keepCount
    );

    for (const backupLog of backupsToDelete) {
      if (
        backupLog.backup_path &&
        fs.existsSync(backupLog.backup_path)
      ) {
        try {
          fs.unlinkSync(backupLog.backup_path);
        } catch {
          // Continue cleanup of log and cloud copy.
        }
      }

      if (backupLog.google_drive_file_id) {
        try {
          await deleteFromGoogleDrive(
            schoolId,
            backupLog.google_drive_file_id
          );
        } catch {
          // Continue cleanup of the local log.
        }
      }

      await pool.query(
        `DELETE FROM backup_logs WHERE id = $1 AND school_id = $2`,
        [backupLog.id, schoolId]
      );
    }
  } catch (error) {
    console.error(
      `Retention cleanup failed for school #${schoolId}:`,
      error
    );
  }
}

export async function executeBackup({
  schoolId: rawSchoolId,
  type,
  userId,
  userName
}) {
  const schoolId = requireValidSchoolId(rawSchoolId);
  const normalizedType = type === 'auto' ? 'auto' : 'manual';
  const startedAt = new Date();

  const settingsResult = await pool.query(
    `SELECT * FROM backup_settings WHERE school_id = $1`,
    [schoolId]
  );

  const settings =
    settingsResult.rowCount > 0
      ? settingsResult.rows[0]
      : {
          backup_path: 'backups',
          keep_backups_count: 10
        };

  const targetDirectory = resolveBackupPath(
    settings.backup_path,
    schoolId
  );

  const finalDirectory = path.join(
    targetDirectory,
    normalizedType
  );

  const dateString = startedAt.toISOString().slice(0, 10);

  const timeString = startedAt
    .toTimeString()
    .slice(0, 8)
    .replace(/:/g, '-');

  const fileName =
    `backup_${normalizedType}_school_${schoolId}_` +
    `${dateString}_${timeString}.sql`;

  const backupPath = path.join(finalDirectory, fileName);

  console.log(
    `[Backup] Starting ${normalizedType} backup for school #${schoolId}`
  );

  const logResult = await pool.query(
    `
      INSERT INTO backup_logs (
        school_id,
        backup_type,
        backup_path,
        status,
        started_at,
        created_by,
        created_by_name
      )
      VALUES (
        $1,
        $2,
        $3,
        'running',
        $4,
        $5,
        $6
      )
      RETURNING id
    `,
    [
      schoolId,
      normalizedType,
      backupPath,
      startedAt,
      userId || null,
      userName ||
        (normalizedType === 'auto'
          ? 'النظام تلقائياً'
          : 'مجهول')
    ]
  );

  const logId = logResult.rows[0].id;

  try {
    await runPgDump(backupPath, schoolId);

    let googleDriveFileId = null;

    try {
      if (settings.google_drive_refresh_token) {
        const uploadResult = await uploadToGoogleDrive({
          schoolId,
          filePath: backupPath,
          fileName,
          refreshToken: settings.google_drive_refresh_token,
          folderId: settings.google_drive_folder_id
        });

        googleDriveFileId = uploadResult.fileId;
      }
    } catch (error) {
      console.warn(
        `Google Drive upload failed: ${error.message}`
      );
    }

    const completedAt = new Date();

    const fileSize = fs.existsSync(backupPath)
      ? fs.statSync(backupPath).size
      : 0;

    await pool.query(
      `
        UPDATE backup_logs
        SET
          status = 'success',
          file_size = $1,
          completed_at = $2,
          google_drive_file_id = $3
        WHERE id = $4
          AND school_id = $5
      `,
      [
        fileSize,
        completedAt,
        googleDriveFileId,
        logId,
        schoolId
      ]
    );

    await pool.query(
      `
        INSERT INTO backup_settings (
          school_id,
          last_backup_at,
          last_backup_status,
          last_backup_path,
          last_backup_error,
          updated_at
        )
        VALUES (
          $1,
          $2,
          'success',
          $3,
          NULL,
          NOW()
        )
        ON CONFLICT (school_id) DO UPDATE
        SET
          last_backup_at = EXCLUDED.last_backup_at,
          last_backup_status = EXCLUDED.last_backup_status,
          last_backup_path = EXCLUDED.last_backup_path,
          last_backup_error = EXCLUDED.last_backup_error,
          updated_at = NOW()
      `,
      [schoolId, completedAt, backupPath]
    );

    await cleanOldBackups(
      schoolId,
      settings.keep_backups_count
    );

    return {
      logId,
      status: 'success',
      path: backupPath,
      size: fileSize
    };
  } catch (error) {
    const completedAt = new Date();

    await pool.query(
      `
        UPDATE backup_logs
        SET
          status = 'failed',
          error_message = $1,
          completed_at = $2
        WHERE id = $3
          AND school_id = $4
      `,
      [error.message, completedAt, logId, schoolId]
    );

    await pool.query(
      `
        INSERT INTO backup_settings (
          school_id,
          last_backup_at,
          last_backup_status,
          last_backup_error,
          updated_at
        )
        VALUES (
          $1,
          $2,
          'failed',
          $3,
          NOW()
        )
        ON CONFLICT (school_id) DO UPDATE
        SET
          last_backup_at = EXCLUDED.last_backup_at,
          last_backup_status = EXCLUDED.last_backup_status,
          last_backup_error = EXCLUDED.last_backup_error,
          updated_at = NOW()
      `,
      [schoolId, completedAt, error.message]
    );

    throw error;
  }
}

function runLocalPsql(inputPath, params) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'psql',
      [
        '-h',
        params.host,
        '-p',
        params.port,
        '-U',
        params.user,
        '-d',
        params.database,
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        inputPath
      ],
      {
        env: {
          ...processEnv,
          PGPASSWORD: params.password
        }
      }
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(`psql restore failed: ${stderr || stdout}`)
        );
      }
    });
  });
}

function runDockerPsql(inputPath, params) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(inputPath);

    const child = spawn('docker', [
      'exec',
      '-i',
      'smart-school-postgres',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      params.user || 'postgres',
      '-d',
      params.database || 'school_system'
    ]);

    let stdout = '';
    let stderr = '';

    fileStream.on('error', reject);
    child.on('error', reject);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    fileStream.pipe(child.stdin);

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(`Docker restore failed: ${stderr || stdout}`)
        );
      }
    });
  });
}

// Restore ONE school's backup only.
// Update the controller call to pass the authenticated user's schoolId.
export async function runPsqlRestore(inputPath, rawSchoolId) {
  const schoolId = requireValidSchoolId(rawSchoolId);
  const params = getDbConnectionParams();

  if (!fs.existsSync(inputPath)) {
    throw new Error('ملف النسخة الاحتياطية غير موجود');
  }

  const header = fs
    .readFileSync(inputPath, 'utf8')
    .slice(0, 2048);

  const expectedHeader =
    `-- School Backup for school_id: ${schoolId}`;

  if (!header.includes(expectedHeader)) {
    throw new Error(
      'لا يمكن استعادة هذه النسخة لأنها لا تخص المدرسة الحالية'
    );
  }

  try {
    return await runLocalPsql(inputPath, params);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }

    console.warn(
      'Local psql executable was not found. Trying docker...'
    );

    return runDockerPsql(inputPath, params);
  }
}
