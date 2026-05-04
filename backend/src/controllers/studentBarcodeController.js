// backend/src/controllers/studentBarcodeController.js
import jwt from "jsonwebtoken";
import QRCode from "qrcode";
import bwipjs from "bwip-js";
import { pool } from "../config/db.js";

const JWT_SECRET = process.env.BARCODE_JWT_SECRET || "CHANGE_ME_NOW";
const TOKEN_TTL_SECONDS = 60;

/* =========================
   Helpers
========================= */

async function tableExists(db, tableName) {
  const r = await db.query(`SELECT to_regclass($1) AS reg`, [`public.${tableName}`]);
  return !!r.rows?.[0]?.reg;
}

const __COL_CACHE = new Map(); // table -> {col:true}
async function getTableColumns(db, tableName) {
  if (__COL_CACHE.has(tableName)) return __COL_CACHE.get(tableName);

  const r = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [tableName]
  );

  const map = Object.create(null);
  for (const row of r.rows || []) map[row.column_name] = true;
  __COL_CACHE.set(tableName, map);
  return map;
}

function makeJti() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2)
  );
}

function maskNumber(v) {
  const s = String(v || "");
  if (!s) return null;
  // نخلي آخر رقمين ظاهرين فقط
  return s.replace(/\d(?=\d{2})/g, "•");
}

/* =========================
   Resolve student by user (Multi-tenant)
========================= */

async function resolveStudentByUser(db, userId, schoolId) {
  const has = await tableExists(db, "students");
  if (!has) return null;

  const cols = await getTableColumns(db, "students");

  // عمود الربط مع users
  const userCol =
    cols.user_id ? "user_id" :
    cols.student_user_id ? "student_user_id" :
    cols.account_user_id ? "account_user_id" :
    cols.user_account_id ? "user_account_id" :
    null;

  if (!userCol) return null;

  // عمود "رقم الطالب" إن وجد (اختياري)
  const numberCol =
    cols.student_number ? "student_number" :
    cols.student_no ? "student_no" :
    cols.registration_number ? "registration_number" :
    cols.registration_no ? "registration_no" :
    cols.academic_number ? "academic_number" :
    cols.code ? "code" :
    cols.number ? "number" :
    null;

  // ✅ التعديل: إضافة شرط school_id لضمان الخصوصية
  const q = `SELECT id${numberCol ? `, ${numberCol} AS student_number` : ""} 
             FROM students 
             WHERE ${userCol}=$1 AND school_id=$2 
             LIMIT 1`;
             
  const r = await db.query(q, [userId, schoolId]);
  return r.rowCount ? r.rows[0] : null;
}

/* =========================
   Controller
========================= */

export const StudentBarcodeController = {
  // GET /api/student/barcode
  async getMyBarcode(req, res) {
    const db = pool;
    const userId = req.user?.id;
    const schoolId = req.user?.school_id; // ✅ استخراج هوية المدرسة من التوكن

    if (!userId || !schoolId) return res.status(401).json({ error: "غير مصرح" });

    try {
      // ✅ تمرير schoolId للدالة لضمان جلب بيانات المدرسة الصحيحة فقط
      const student = await resolveStudentByUser(db, userId, schoolId);
      
      if (!student) {
        return res.status(404).json({
          error:
            "لم يتم العثور على الطالب المرتبط بهذا الحساب في هذه المدرسة.",
        });
      }

      const jti = makeJti();

      // ✅ التوكن الأساسي للـ QR (يتضمن هوية الطالب)
      const token = jwt.sign({ sid: student.id, jti, sch: schoolId }, JWT_SECRET, {
        expiresIn: TOKEN_TTL_SECONDS,
      });

      const qrText = `SS:${token}`;
      const qrDataUrl = await QRCode.toDataURL(qrText, {
        errorCorrectionLevel: "M",
        margin: 1,
        scale: 8,
      });

      // ✅ Barcode token قصير (يتضمن مرجع المدرسة sch للتأكيد لاحقاً)
      const baseNumber = student.student_number || student.id; 
      const shortPayload = { sid: student.id, n: String(baseNumber), k: jti.slice(-8), sch: schoolId };
      const shortToken = jwt.sign(shortPayload, JWT_SECRET, {
        expiresIn: TOKEN_TTL_SECONDS,
      });

      const png = await bwipjs.toBuffer({
        bcid: "code128",
        text: `SS:${shortToken}`,
        scale: 4,
        height: 18,
        includetext: true,
        textsize: 10,
        textxalign: "center",
        padding: 8,
        backgroundcolor: "FFFFFF",
      });

      const barcodeDataUrl = "data:image/png;base64," + png.toString("base64");

      return res.json({
        expiresIn: TOKEN_TTL_SECONDS,
        studentId: student.id,
        studentNumberMasked: student.student_number ? maskNumber(student.student_number) : null,
        qrDataUrl,
        barcodeDataUrl,
      });
    } catch (e) {
      console.error("student barcode error:", e);
      return res.status(500).json({ error: "خطأ داخلي في توليد باركود الطالب" });
    }
  },
};