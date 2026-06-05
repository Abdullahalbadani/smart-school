import { pool } from "./src/config/db.js";

const targetTables = [
  "activity_logs", "assessment_grades", "assessments", "attendance_entries", 
  "attendance_entry_corrections", "attendance_reasons", "attendance_sessions", 
  "exam_timetables", "fee_contracts", "fee_installments", "fee_payment_allocations", 
  "fee_payments", "fee_rules", "grade_change_logs", "lesson_substitutions", 
  "monthly_work_approvals", "notification_attachments", "notification_recipients", 
  "notifications", "periods", "permission_requests", "school_settings", 
  "student_monthly_certificates", "teacher_attendance_days", 
  "teacher_attendance_settings", "teacher_barcode_tokens", 
  "teacher_lesson_presence", "teacher_permission_request_slots", 
  "teacher_permission_requests", "term_result_batches", "term_result_students", 
  "term_result_subjects", "term_work_approvals"
];

async function run() {
  console.log("=== STARTING DATABASE SELF-HEALING & MIGRATION ===");
  const client = await pool.connect();

  try {
    // ----------------------------------------------------
    // 🟢 المرحلة الأولى: معالجة وتطهير قيم الـ NULL
    // ----------------------------------------------------
    console.log("\n[1/2] starting Phase 1: Null values cleanup...");

    // 1. attendance_entries
    console.log("  Cleaning attendance_entries.school_id...");
    const aeRes = await client.query(
      `UPDATE attendance_entries ae
       SET school_id = ses.school_id
       FROM attendance_sessions ses
       WHERE ae.session_id = ses.id AND ae.school_id IS NULL`
    );
    console.log(`  Done. Row(s) updated: ${aeRes.rowCount}`);

    // 2. teacher_attendance_days
    console.log("  Cleaning teacher_attendance_days.school_id...");
    const tadRes = await client.query(
      `UPDATE teacher_attendance_days tad
       SET school_id = ay.school_id
       FROM academic_years ay
       WHERE tad.academic_year_id = ay.id AND tad.school_id IS NULL`
    );
    console.log(`  Done. Row(s) updated: ${tadRes.rowCount}`);

    // 3. attendance_reasons
    console.log("  Cleaning attendance_reasons.school_id...");
    const arRes = await client.query(
      `UPDATE attendance_reasons SET school_id = 1 WHERE school_id IS NULL`
    );
    console.log(`  Done. Row(s) updated: ${arRes.rowCount}`);

    console.log("Phase 1 completed successfully.");

    // ----------------------------------------------------
    // 🟢 المرحلة الثانية: تطبيق القيود والفهارس والمفاتيح الأجنبية
    // ----------------------------------------------------
    console.log("\n[2/2] starting Phase 2: Altering tables one-by-one...");

    for (const table of targetTables) {
      console.log(`\n-------------------------------------`);
      console.log(`Processing table: "${table}"`);

      // We run queries for this table inside a transaction
      await client.query("BEGIN");

      try {
        // 1. Get current metadata
        const colRes = await client.query(
          `SELECT is_nullable 
           FROM information_schema.columns 
           WHERE table_name = $1 AND column_name = 'school_id'`,
          [table]
        );

        if (colRes.rowCount === 0) {
          console.log(`  Skipping: column 'school_id' does not exist in "${table}".`);
          await client.query("COMMIT");
          continue;
        }

        const isNullable = colRes.rows[0].is_nullable === "YES";

        // Check if index exists
        const indexRes = await client.query(
          `SELECT indexname 
           FROM pg_indexes 
           WHERE tablename = $1 AND indexdef LIKE '%school_id%'`,
          [table]
        );
        const indexExists = indexRes.rowCount > 0;

        // Check if FK exists
        const fkRes = await client.query(
          `SELECT con.conname 
           FROM pg_constraint con 
           JOIN pg_class cl ON cl.oid = con.conrelid 
           WHERE cl.relname = $1 
             AND con.contype = 'f' 
             AND pg_get_constraintdef(con.oid) LIKE '%school_id%'
             AND pg_get_constraintdef(con.oid) LIKE '%schools%'`,
          [table]
        );
        const fkExists = fkRes.rowCount > 0;

        // 2. Apply NOT NULL if needed
        if (isNullable) {
          console.log(`  Applying: SET NOT NULL on "${table}".school_id...`);
          await client.query(`ALTER TABLE "${table}" ALTER COLUMN school_id SET NOT NULL`);
          console.log(`  NOT NULL applied.`);
        } else {
          console.log(`  school_id is already NOT NULL.`);
        }

        // 3. Apply Index if needed
        if (!indexExists) {
          console.log(`  Applying: CREATE INDEX on "${table}"(school_id)...`);
          await client.query(`CREATE INDEX "idx_${table}_school_id" ON "${table}"(school_id)`);
          console.log(`  Index created.`);
        } else {
          console.log(`  Index already exists.`);
        }

        // 4. Apply FK if needed
        if (!fkExists) {
          console.log(`  Applying: ADD FOREIGN KEY CONSTRAINT on "${table}".school_id...`);
          await client.query(
            `ALTER TABLE "${table}" 
             ADD CONSTRAINT "fk_${table}_school" 
             FOREIGN KEY (school_id) REFERENCES schools(id) ON DELETE CASCADE`
          );
          console.log(`  Foreign Key constraint added.`);
        } else {
          console.log(`  Foreign Key constraint already exists.`);
        }

        await client.query("COMMIT");
        console.log(`Successfully completed all migrations for table "${table}".`);

      } catch (tableError) {
        await client.query("ROLLBACK");
        console.error(`❌ FAILED processing table "${table}". ABORTING MIGRATIONS.`);
        throw tableError; // This breaks the loop and halts execution
      }
    }

    console.log(`\n=====================================`);
    console.log("🎉 ALL MIGRATIONS COMPLETED SUCCESSFULLY!");
    console.log(`=====================================`);

  } catch (globalError) {
    console.error("\n❌ MIGRATION ABORTED DUE TO AN ERROR:", globalError);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
