import { pool } from "./src/config/db.js";
import fs from "fs";

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
  console.log("Starting database analysis on the 33 tables...");
  const results = [];

  for (const table of targetTables) {
    try {
      // 1. Check if column exists, its type and nullability
      const colRes = await pool.query(
        `SELECT data_type, is_nullable 
         FROM information_schema.columns 
         WHERE table_name = $1 AND column_name = 'school_id'`,
        [table]
      );

      if (colRes.rowCount === 0) {
        results.push({
          table,
          hasSchoolId: false,
          type: "—",
          isNullable: "—",
          nullCount: 0,
          orphanedCount: 0,
          hasIndex: false,
          hasFk: false,
          status: "غير موجود"
        });
        continue;
      }

      const colInfo = colRes.rows[0];
      const type = colInfo.data_type.toUpperCase();
      const isNullable = colInfo.is_nullable === "YES";

      // 2. Count NULL values
      const nullCountRes = await pool.query(`SELECT COUNT(*)::int AS count FROM "${table}" WHERE school_id IS NULL`);
      const nullCount = nullCountRes.rows[0].count;

      // 3. Count orphaned rows
      let orphanedCount = 0;
      try {
        const orphanedCountRes = await pool.query(
          `SELECT COUNT(*)::int AS count 
           FROM "${table}" t 
           LEFT JOIN schools s ON t.school_id = s.id 
           WHERE s.id IS NULL AND t.school_id IS NOT NULL`
        );
        orphanedCount = orphanedCountRes.rows[0].count;
      } catch (err) {
        console.error(`Error counting orphaned rows for ${table}:`, err.message);
      }

      // 4. Check if index exists on school_id
      const indexRes = await pool.query(
        `SELECT indexname 
         FROM pg_indexes 
         WHERE tablename = $1 AND indexdef LIKE '%school_id%'`,
        [table]
      );
      const hasIndex = indexRes.rowCount > 0;

      // 5. Check if Foreign Key exists on school_id referencing schools
      const fkRes = await pool.query(
        `SELECT con.conname 
         FROM pg_constraint con 
         JOIN pg_class cl ON cl.oid = con.conrelid 
         WHERE cl.relname = $1 
           AND con.contype = 'f' 
           AND pg_get_constraintdef(con.oid) LIKE '%school_id%'
           AND pg_get_constraintdef(con.oid) LIKE '%schools%'`,
        [table]
      );
      const hasFk = fkRes.rowCount > 0;

      let status = "سليم";
      if (!hasIndex || !hasFk || isNullable) {
        status = "يحتاج إصلاح";
      }

      results.push({
        table,
        hasSchoolId: true,
        type,
        isNullable,
        nullCount,
        orphanedCount,
        hasIndex,
        hasFk,
        status
      });

    } catch (err) {
      console.error(`Failed to audit table ${table}:`, err);
      results.push({
        table,
        hasSchoolId: "خطأ",
        type: "—",
        isNullable: "—",
        nullCount: "—",
        orphanedCount: "—",
        hasIndex: "—",
        hasFk: "—",
        status: "خطأ في الاستعلام"
      });
    }
  }

  // Generate markdown table
  let md = [];
  md.push("| الجدول | school_id موجود؟ | النوع | NULL مسموح؟ | عدد NULLs | orphaned rows | Index موجود؟ | FK موجود؟ | الحالة |");
  md.push("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |");

  results.forEach(r => {
    md.push(`| ${r.table} | ${r.hasSchoolId ? "✅ (" + r.type + ")" : "❌"} | ${r.type} | ${r.isNullable ? "نعم" : "لا"} | ${r.nullCount} | ${r.orphanedCount} | ${r.hasIndex ? "✅" : "❌"} | ${r.hasFk ? "✅" : "❌"} | ${r.status} |`);
  });

  fs.writeFileSync("C:\\Users\\amazon\\.gemini\\antigravity\\scratch\\audit_partially_isolated.txt", md.join("\n"), "utf8");
  console.log("Analysis completed. Results written to audit_partially_isolated.txt");
  
  await pool.end();
}

run();
