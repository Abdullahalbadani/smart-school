import { pool } from "../config/db.js";

const ddl = `
CREATE TABLE IF NOT EXISTS backup_settings (
    id BIGSERIAL PRIMARY KEY,
    school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    
    -- إعدادات النسخ التلقائي
    auto_backup_enabled BOOLEAN DEFAULT false,
    auto_backup_frequency VARCHAR(20) DEFAULT 'daily', -- 'hourly', 'daily', 'weekly', 'monthly', 'custom'
    auto_backup_interval_hours INT DEFAULT 24, -- للتكرار المخصص (كل X ساعة)
    
    -- وقت النسخ التلقائي
    auto_backup_time TIME DEFAULT '02:00:00',
    
    -- أيام النسخ (للأسبوعي)
    auto_backup_day INT DEFAULT 0, -- 0=الأحد, 1=الاثنين, ..., 6=السبت
    
    -- المسار
    backup_path VARCHAR(500) DEFAULT 'backups',
    
    -- الاحتفاظ
    keep_backups_count INT DEFAULT 10,
    
    -- الحالة
    last_backup_at TIMESTAMP,
    last_backup_status VARCHAR(20), -- 'success', 'failed', 'running'
    last_backup_path VARCHAR(500),
    last_backup_error TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(school_id)
);

CREATE TABLE IF NOT EXISTS backup_logs (
    id BIGSERIAL PRIMARY KEY,
    school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    
    backup_type VARCHAR(20) NOT NULL, -- 'manual', 'auto'
    backup_path VARCHAR(500) NOT NULL,
    file_size BIGINT, -- بالبايت
    status VARCHAR(20) NOT NULL, -- 'success', 'failed'
    error_message TEXT,
    
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    
    created_by INT REFERENCES users(id) ON DELETE SET NULL, -- معرف المستخدم (لليدوي)
    created_by_name VARCHAR(255), -- اسم المستخدم
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_school ON backup_logs(school_id);
CREATE INDEX IF NOT EXISTS idx_backup_logs_created ON backup_logs(created_at DESC);
`;

async function migrate() {
  console.log("⏳ Starting backup tables migration...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(ddl);
    await client.query("COMMIT");
    console.log("✅ Backup tables migration completed successfully!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Migration failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
