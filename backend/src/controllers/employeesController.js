// src/controllers/employeesController.js
import bcrypt from "bcryptjs";
import { pool } from "../config/db.js";

/* =========================
   Utils
========================= */
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function toBool(v) {
  return v === true || v === 1 || v === "1" || v === "true";
}
function s(v) {
  const t = String(v ?? "").trim();
  return t ? t : null;
}

let _usersCols = null;
let _teachersCols = null;

async function detectCols(client, table) {
  const r = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return new Set(r.rows.map((x) => x.column_name));
}

async function usersCols(client) {
  if (_usersCols) return _usersCols;
  _usersCols = await detectCols(client, "users");
  return _usersCols;
}
async function teachersCols(client) {
  if (_teachersCols) return _teachersCols;
  _teachersCols = await detectCols(client, "teachers");
  return _teachersCols;
}

async function tableExists(client, table) {
  const r = await client.query(
    `SELECT 1
     FROM information_schema.tables
     WHERE table_schema='public' AND table_name=$1
     LIMIT 1`,
    [table]
  );
  return !!r.rows[0];
}

function userExpr(cols, col, alias, type = "text", fallback = "NULL") {
  if (cols.has(col)) return `${alias}.${col}`;
  if (fallback === "NULL") return `NULL::${type}`;
  return `${fallback}::${type}`;
}

function userFullNameExpr(cols, alias = "u") {
  if (cols.has("full_name")) return `${alias}.full_name`;
  if (cols.has("name")) return `${alias}.name`;
  return `NULL::text`;
}

function userIsActiveExpr(cols, alias = "u") {
  if (cols.has("is_active")) return `COALESCE(${alias}.is_active, TRUE)`;
  if (cols.has("status")) return `(COALESCE(${alias}.status,'active') = 'active')`;
  return `TRUE`;
}

function userSelectList(cols, alias = "u") {
  return [
    `${alias}.id AS id`,
    `${alias}.school_id AS school_id`,
    `${userExpr(cols, "username", alias, "text")} AS username`,
    `${userFullNameExpr(cols, alias)} AS full_name`,
    `${userExpr(cols, "phone", alias, "text")} AS phone`,
    `${userExpr(cols, "email", alias, "text")} AS email`,
    `${userIsActiveExpr(cols, alias)} AS is_active`,
  ];
}

/* =========================
   User Roles
========================= */
async function setUserRolesTx(client, userId, roleIds) {
  if (!userId) return;

  await client.query(`DELETE FROM user_roles WHERE user_id=$1`, [userId]);

  if (!Array.isArray(roleIds) || roleIds.length === 0) return;

  const values = [];
  const params = [];
  let p = 1;

  for (const rid of roleIds.map(Number).filter(Number.isFinite)) {
    values.push(`($${p++}, $${p++})`);
    params.push(userId, rid);
  }

  if (values.length) {
    await client.query(
      `INSERT INTO user_roles (user_id, role_id) VALUES ${values.join(",")}`,
      params
    );
  }
}

async function getUserRoleIds(client, userId) {
  if (!userId) return [];
  const r = await client.query(
    `SELECT role_id FROM user_roles WHERE user_id=$1 ORDER BY role_id`,
    [userId]
  );
  return r.rows.map((x) => Number(x.role_id));
}

/* =========================
   Create User
========================= */
async function createUserTx(client, payload) {
  const cols = await usersCols(client);

  const schoolId = Number(payload.school_id);
  const username = s(payload.username);
  const password = String(payload.password ?? "");
  const full_name = s(payload.full_name);
  const phone = s(payload.phone);
  const email = s(payload.email);
  const is_active = toBool(payload.is_active ?? true);

  if (!schoolId) throw new Error("school_id مطلوب لإنشاء الحساب");
  if (!username) throw new Error("اسم المستخدم مطلوب لإنشاء الحساب");
  if (!password) throw new Error("كلمة المرور مطلوبة لإنشاء الحساب");

  const passCol = cols.has("password_hash")
    ? "password_hash"
    : cols.has("password")
    ? "password"
    : null;
  if (!passCol) throw new Error("جدول users لا يحتوي password_hash أو password");

  const nameCol = cols.has("full_name") ? "full_name" : cols.has("name") ? "name" : null;
  if (!nameCol) throw new Error("جدول users لا يحتوي name أو full_name");
  if (!full_name) throw new Error("الاسم مطلوب لإنشاء الحساب");

  if (cols.has("email") && !email) throw new Error("البريد الإلكتروني مطلوب لإنشاء الحساب");

  const usernameChk = await client.query(
    `
    SELECT id
    FROM users
    WHERE school_id = $1
      AND username = $2
    LIMIT 1
    `,
    [schoolId, username]
  );
  if (usernameChk.rowCount > 0) throw new Error("اسم المستخدم مستخدم مسبقًا داخل نفس المدرسة");

  if (cols.has("email") && email) {
    const emailChk = await client.query(
      `
      SELECT id
      FROM users
      WHERE school_id = $1
        AND LOWER(email) = LOWER($2)
      LIMIT 1
      `,
      [schoolId, email]
    );
    if (emailChk.rowCount > 0) throw new Error("البريد الإلكتروني مستخدم مسبقًا داخل نفس المدرسة");
  }

  const hash = await bcrypt.hash(password, 10);

  const insertCols = ["school_id", "username", passCol, nameCol];
  const insertVals = ["$1", "$2", "$3", "$4"];
  const params = [schoolId, username, hash, full_name];
  let i = 5;

  if (cols.has("email")) {
    insertCols.push("email");
    insertVals.push(`$${i++}`);
    params.push(email);
  }
  if (cols.has("phone") && phone) {
    insertCols.push("phone");
    insertVals.push(`$${i++}`);
    params.push(phone);
  }

  if (cols.has("status")) {
    insertCols.push("status");
    insertVals.push(`$${i++}`);
    params.push(is_active ? "active" : "inactive");
  } else if (cols.has("is_active")) {
    insertCols.push("is_active");
    insertVals.push(`$${i++}`);
    params.push(is_active);
  }

  if (cols.has("token_version")) {
    insertCols.push("token_version");
    insertVals.push(`$${i++}`);
    params.push(0);
  }

  const q = `
    INSERT INTO users (${insertCols.join(",")})
    VALUES (${insertVals.join(",")})
    RETURNING id
  `;
  const r = await client.query(q, params);
  return Number(r.rows[0].id);
}

/* =========================
   Teacher helper
========================= */
async function ensureTeacherTx(client, { school_id, teacher_id, user_id, full_name, phone, is_active }) {
  const tcols = await teachersCols(client);

  let tid = teacher_id ? Number(teacher_id) : null;

  if (!tid && user_id) {
    const rr = await client.query(
      `
      SELECT id
      FROM teachers
      WHERE user_id = $1
        AND school_id = $2
      LIMIT 1
      `,
      [user_id, school_id]
    );
    tid = rr.rows[0]?.id ? Number(rr.rows[0].id) : null;
  }

  if (tid) {
    const setParts = [];
    const params = [];
    let p = 1;

    if (tcols.has("full_name")) {
      setParts.push(`full_name=$${p++}`);
      params.push(full_name);
    }
    if (tcols.has("phone")) {
      setParts.push(`phone=$${p++}`);
      params.push(phone);
    }
    if (tcols.has("user_id")) {
      setParts.push(`user_id=$${p++}`);
      params.push(user_id);
    }
    if (tcols.has("is_active")) {
      setParts.push(`is_active=$${p++}`);
      params.push(is_active);
    }
    if (tcols.has("updated_at")) {
      setParts.push(`updated_at=now()`);
    }

    if (setParts.length === 0) return tid;

    params.push(tid, school_id);
    await client.query(
      `UPDATE teachers SET ${setParts.join(", ")} WHERE id=$${p} AND school_id=$${p + 1}`,
      params
    );
    return tid;
  }

  const insCols = [];
  const insVals = [];
  const insParams = [];
  let i = 1;

  if (tcols.has("school_id")) {
    insCols.push("school_id");
    insVals.push(`$${i++}`);
    insParams.push(school_id);
  }
  if (tcols.has("full_name")) {
    insCols.push("full_name");
    insVals.push(`$${i++}`);
    insParams.push(full_name);
  }
  if (tcols.has("phone")) {
    insCols.push("phone");
    insVals.push(`$${i++}`);
    insParams.push(phone);
  }
  if (tcols.has("user_id")) {
    insCols.push("user_id");
    insVals.push(`$${i++}`);
    insParams.push(user_id);
  }
  if (tcols.has("is_active")) {
    insCols.push("is_active");
    insVals.push(`$${i++}`);
    insParams.push(is_active);
  }

  const r = await client.query(
    `INSERT INTO teachers (${insCols.join(",")}) VALUES (${insVals.join(",")}) RETURNING id`,
    insParams
  );
  return Number(r.rows[0].id);
}

function normAccount(body) {
  const acc = body.account || {};
  return {
    mode: String(acc.mode || "none"),
    user_id: toInt(acc.user_id),
    username: s(acc.username),
    password: acc.password ?? "",
    email: s(acc.email),
  };
}

/* ================== META ================== */
export const employeesMeta = async (req, res) => {
  const client = await pool.connect();
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const rolesR = await client.query(
      `SELECT id, name, COALESCE(description,'') AS description FROM roles ORDER BY id ASC`
    );

    const ucols = await usersCols(client);

    const usersQ = `
      WITH ub AS (
        SELECT ${userSelectList(ucols, "u").join(", ")}
        FROM users u
        WHERE u.school_id = $1
      )
      SELECT
        ub.*,
        COALESCE(
          array_agg(DISTINCT ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL),
          '{}'::int[]
        ) AS role_ids,
        COALESCE(
          jsonb_agg(
            DISTINCT jsonb_build_object(
              'id', r.id,
              'name', r.name,
              'description', COALESCE(r.description,'')
            )
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'::jsonb
        ) AS roles
      FROM ub
      LEFT JOIN user_roles ur ON ur.user_id = ub.id
      LEFT JOIN roles r ON r.id = ur.role_id
      GROUP BY ub.id, ub.school_id, ub.username, ub.full_name, ub.phone, ub.email, ub.is_active
      ORDER BY ub.id DESC
    `;

    const usersR = await client.query(usersQ, [schoolId]);

    return res.json({ data: { roles: rolesR.rows, users: usersR.rows } });
  } catch (e) {
    console.error("employeesMeta error:", e);
    return res.status(500).json({ error: "فشل جلب البيانات (users/roles)" });
  } finally {
    client.release();
  }
};

/* ================== LIST ================== */
export const employeesList = async (req, res) => {
  const client = await pool.connect();
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const q = s(req.query.search)?.toLowerCase() || null;
    const tab = String(req.query.tab || "all");

    const params = [schoolId];
    const where = [`e.school_id = $1`];
    let p = 2;

    if (q) {
      where.push(
        `(LOWER(e.full_name) LIKE $${p++} OR e.phone LIKE $${p++} OR LOWER(COALESCE(e.job_title,'')) LIKE $${p++})`
      );
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    if (tab === "teachers") where.push(`e.is_teacher = TRUE`);
    if (tab === "employees") where.push(`e.is_teacher = FALSE`);

    const whereSql = `WHERE ${where.join(" AND ")}`;

    const ucols = await usersCols(client);

    const r = await client.query(
      `
      SELECT
        e.*,
        ${userExpr(ucols, "username", "u", "text")} AS username,
        ${userFullNameExpr(ucols, "u")} AS user_full_name,
        ${userExpr(ucols, "email", "u", "text")} AS user_email,
        ${userExpr(ucols, "phone", "u", "text")} AS user_phone,
        ${userIsActiveExpr(ucols, "u")} AS user_is_active
      FROM employees e
      LEFT JOIN users u
        ON u.id::bigint = e.user_id
       AND u.school_id = e.school_id
      ${whereSql}
      ORDER BY e.id DESC
      `,
      params
    );

    return res.json({ data: r.rows });
  } catch (e) {
    console.error("employeesList error:", e);
    return res.status(500).json({ error: "حدث خطأ في جلب الموظفين" });
  } finally {
    client.release();
  }
};

/* ================== GET ONE ================== */
export const employeeGet = async (req, res) => {
  const client = await pool.connect();
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "معرّف غير صحيح" });

    const ucols = await usersCols(client);

    const r = await client.query(
      `
      SELECT
        e.*,
        ${userExpr(ucols, "username", "u", "text")} AS username,
        ${userFullNameExpr(ucols, "u")} AS user_full_name,
        ${userExpr(ucols, "phone", "u", "text")} AS user_phone,
        ${userExpr(ucols, "email", "u", "text")} AS user_email,
        ${userIsActiveExpr(ucols, "u")} AS user_is_active
      FROM employees e
      LEFT JOIN users u
        ON u.id::bigint = e.user_id
       AND u.school_id = e.school_id
      WHERE e.id = $1
        AND e.school_id = $2
      LIMIT 1
      `,
      [id, schoolId]
    );

    const employee = r.rows[0];
    if (!employee) return res.status(404).json({ error: "غير موجود" });

    const role_ids = employee.user_id ? await getUserRoleIds(client, Number(employee.user_id)) : [];
    return res.json({ data: { employee, role_ids } });
  } catch (e) {
    console.error("employeeGet error:", e);
    return res.status(500).json({ error: "حدث خطأ" });
  } finally {
    client.release();
  }
};

/* ================== CREATE ================== */
export const employeeCreate = async (req, res) => {
  const client = await pool.connect();
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const body = req.body || {};

    const full_name = s(body.full_name);
    const phone = s(body.phone);
    const job_title = s(body.job_title);
    const notes = s(body.notes);
    const is_teacher = toBool(body.is_teacher);
    const is_active = toBool(body.is_active ?? true);

    if (!full_name) return res.status(400).json({ error: "الاسم مطلوب" });
    if (!phone) return res.status(400).json({ error: "الجوال مطلوب" });

    const role_ids = Array.isArray(body.role_ids) ? body.role_ids.map(Number) : [];
    const acc = normAccount(body);

    await client.query("BEGIN");

    let userId = null;

    if (acc.mode === "link") {
      if (!acc.user_id) throw new Error("اختر حسابًا للربط");

      const userChk = await client.query(
        `
        SELECT id
        FROM users
        WHERE id = $1
          AND school_id = $2
        LIMIT 1
        `,
        [acc.user_id, schoolId]
      );
      if (userChk.rowCount === 0) throw new Error("الحساب غير موجود داخل هذه المدرسة");

      const chk = await client.query(
        `
        SELECT id
        FROM employees
        WHERE user_id = $1
          AND school_id = $2
        LIMIT 1
        `,
        [acc.user_id, schoolId]
      );
      if (chk.rows[0]) throw new Error("هذا الحساب مربوط مسبقًا بموظف آخر");

      userId = acc.user_id;
    } else if (acc.mode === "create") {
      userId = await createUserTx(client, {
        school_id: schoolId,
        username: acc.username,
        password: acc.password,
        email: acc.email,
        full_name,
        phone,
        is_active,
      });
    } else {
      userId = null;
    }

    const ins = await client.query(
      `
      INSERT INTO employees (school_id, user_id, teacher_id, full_name, phone, job_title, notes, is_teacher, is_active)
      VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [schoolId, userId, full_name, phone, job_title, notes, is_teacher, is_active]
    );

    let employee = ins.rows[0];

    if (userId) {
      await setUserRolesTx(client, userId, role_ids);
    }

    if (is_teacher) {
      const teacherId = await ensureTeacherTx(client, {
        school_id: schoolId,
        teacher_id: null,
        user_id: userId,
        full_name,
        phone,
        is_active,
      });

      const up = await client.query(
        `
        UPDATE employees
        SET teacher_id = $1, updated_at = now()
        WHERE id = $2
          AND school_id = $3
        RETURNING *
        `,
        [teacherId, employee.id, schoolId]
      );
      employee = up.rows[0];
    }

    await client.query("COMMIT");
    return res.json({ data: employee });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("employeeCreate error:", e);
    return res.status(400).json({ error: e.message || "فشل الحفظ" });
  } finally {
    client.release();
  }
};

/* ================== UPDATE ================== */
export const employeeUpdate = async (req, res) => {
  const client = await pool.connect();
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "معرّف غير صحيح" });

    const body = req.body || {};
    const full_name = s(body.full_name);
    const phone = s(body.phone);
    const job_title = s(body.job_title);
    const notes = s(body.notes);
    const is_teacher = toBool(body.is_teacher);
    const is_active = toBool(body.is_active ?? true);

    if (!full_name) return res.status(400).json({ error: "الاسم مطلوب" });
    if (!phone) return res.status(400).json({ error: "الجوال مطلوب" });

    const role_ids = Array.isArray(body.role_ids) ? body.role_ids.map(Number) : [];
    const acc = normAccount(body);

    await client.query("BEGIN");

    const curR = await client.query(
      `
      SELECT *
      FROM employees
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      `,
      [id, schoolId]
    );

    const cur = curR.rows[0];
    if (!cur) throw new Error("الموظف غير موجود");

    let userId = cur.user_id ? Number(cur.user_id) : null;

    if (acc.mode === "link") {
      if (!acc.user_id) throw new Error("اختر حسابًا للربط");

      const userChk = await client.query(
        `
        SELECT id
        FROM users
        WHERE id = $1
          AND school_id = $2
        LIMIT 1
        `,
        [acc.user_id, schoolId]
      );
      if (userChk.rowCount === 0) throw new Error("الحساب غير موجود داخل هذه المدرسة");

      const other = await client.query(
        `
        SELECT id
        FROM employees
        WHERE user_id = $1
          AND school_id = $2
          AND id <> $3
        LIMIT 1
        `,
        [acc.user_id, schoolId, id]
      );
      if (other.rows[0]) throw new Error("هذا الحساب مربوط مسبقًا بموظف آخر");
      userId = acc.user_id;
    } else if (acc.mode === "create") {
      userId = await createUserTx(client, {
        school_id: schoolId,
        username: acc.username,
        password: acc.password,
        email: acc.email,
        full_name,
        phone,
        is_active,
      });
    } else if (acc.mode === "none") {
      userId = null;
    }

    const up = await client.query(
      `
      UPDATE employees
      SET user_id = $1, full_name = $2, phone = $3, job_title = $4, notes = $5,
          is_teacher = $6, is_active = $7, updated_at = now()
      WHERE id = $8
        AND school_id = $9
      RETURNING *
      `,
      [userId, full_name, phone, job_title, notes, is_teacher, is_active, id, schoolId]
    );

    let employee = up.rows[0];

    if (userId) {
      await setUserRolesTx(client, userId, role_ids);
    }

    if (is_teacher) {
      const teacherId = await ensureTeacherTx(client, {
        school_id: schoolId,
        teacher_id: employee.teacher_id,
        user_id: userId,
        full_name,
        phone,
        is_active,
      });

      const up2 = await client.query(
        `
        UPDATE employees
        SET teacher_id = $1, updated_at = now()
        WHERE id = $2
          AND school_id = $3
        RETURNING *
        `,
        [teacherId, id, schoolId]
      );
      employee = up2.rows[0];
    } else {
      if (employee.teacher_id) {
        const up3 = await client.query(
          `
          UPDATE employees
          SET teacher_id = NULL, updated_at = now()
          WHERE id = $1
            AND school_id = $2
          RETURNING *
          `,
          [id, schoolId]
        );
        employee = up3.rows[0];
      }
    }

    await client.query("COMMIT");
    return res.json({ data: employee });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("employeeUpdate error:", e);
    return res.status(400).json({ error: e.message || "فشل التحديث" });
  } finally {
    client.release();
  }
};

/* ================== SET ACTIVE ================== */
export const employeeSetActive = async (req, res) => {
  const client = await pool.connect();
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const id = toInt(req.params.id);
    const is_active = toBool(req.body?.is_active);

    if (!id) return res.status(400).json({ error: "معرّف غير صحيح" });

    await client.query("BEGIN");

    const cur = await client.query(
      `
      SELECT id, user_id, teacher_id
      FROM employees
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      FOR UPDATE
      `,
      [id, schoolId]
    );

    const row = cur.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "الموظف غير موجود" });
    }

    const upEmp = await client.query(
      `
      UPDATE employees
      SET is_active = $1, updated_at = now()
      WHERE id = $2
        AND school_id = $3
      RETURNING *
      `,
      [is_active, id, schoolId]
    );

    if (row.teacher_id) {
      const tcols = await teachersCols(client);
      if (tcols.has("is_active")) {
        const extra = tcols.has("updated_at") ? `, updated_at=now()` : ``;
        await client.query(
          `UPDATE teachers SET is_active=$1${extra} WHERE id=$2 AND school_id=$3`,
          [is_active, Number(row.teacher_id), schoolId]
        );
      }
    }

    if (row.user_id) {
      const ucols = await usersCols(client);
      const uid = Number(row.user_id);

      if (ucols.has("status")) {
        await client.query(
          `UPDATE users SET status=$1 WHERE id=$2 AND school_id=$3`,
          [is_active ? "active" : "inactive", uid, schoolId]
        );
      } else if (ucols.has("is_active")) {
        await client.query(
          `UPDATE users SET is_active=$1 WHERE id=$2 AND school_id=$3`,
          [is_active, uid, schoolId]
        );
      }

      if (ucols.has("token_version")) {
        await client.query(
          `UPDATE users SET token_version=COALESCE(token_version,0)+1 WHERE id=$1 AND school_id=$2`,
          [uid, schoolId]
        );
      }
    }

    await client.query("COMMIT");
    return res.json({ data: upEmp.rows[0] });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("employeeSetActive error:", e);
    return res.status(500).json({ error: "فشل التحديث" });
  } finally {
    client.release();
  }
};

/* ================== DELETE ================== */
export const employeeDelete = async (req, res) => {
  const client = await pool.connect();
  try {
    const schoolId = req.user?.school_id;
    if (!schoolId) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const id = toInt(req.params.id);
    if (!id) return res.status(400).json({ error: "معرّف غير صحيح" });

    const hard = toBool(req.query?.hard) || toBool(req.query?.force);

    await client.query("BEGIN");

    const cur = await client.query(
      `
      SELECT id, user_id, teacher_id, full_name, is_active
      FROM employees
      WHERE id = $1
        AND school_id = $2
      LIMIT 1
      FOR UPDATE
      `,
      [id, schoolId]
    );

    const row = cur.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "الموظف غير موجود" });
    }

    if (!hard) {
      const upEmp = await client.query(
        `
        UPDATE employees
        SET is_active = FALSE, updated_at = now()
        WHERE id = $1
          AND school_id = $2
        RETURNING *
        `,
        [id, schoolId]
      );

      if (row.teacher_id) {
        const tcols = await teachersCols(client);
        if (tcols.has("is_active")) {
          const extra = tcols.has("updated_at") ? `, updated_at=now()` : ``;
          await client.query(
            `UPDATE teachers SET is_active=FALSE${extra} WHERE id=$1 AND school_id=$2`,
            [Number(row.teacher_id), schoolId]
          );
        }
      }

      if (row.user_id) {
        const ucols = await usersCols(client);
        const uid = Number(row.user_id);

        if (ucols.has("status")) {
          await client.query(
            `UPDATE users SET status='inactive' WHERE id=$1 AND school_id=$2`,
            [uid, schoolId]
          );
        } else if (ucols.has("is_active")) {
          await client.query(
            `UPDATE users SET is_active=FALSE WHERE id=$1 AND school_id=$2`,
            [uid, schoolId]
          );
        }

        if (ucols.has("token_version")) {
          await client.query(
            `UPDATE users SET token_version=COALESCE(token_version,0)+1 WHERE id=$1 AND school_id=$2`,
            [uid, schoolId]
          );
        }
      }

      await client.query("COMMIT");
      return res.json({
        ok: true,
        mode: "soft",
        message: "تم التعطيل ✅",
        data: upEmp.rows[0],
      });
    }

    const teacherId = row.teacher_id ? Number(row.teacher_id) : null;

    if (teacherId && (await tableExists(client, "timetable_entries"))) {
      const ttCols = await detectCols(client, "timetable_entries");
      if (ttCols.has("teacher_id")) {
        const ref = await client.query(
          `SELECT 1 FROM timetable_entries WHERE teacher_id=$1 LIMIT 1`,
          [teacherId]
        );
        if (ref.rows[0]) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error:
              "لا يمكن الحذف النهائي لأن هذا المعلم مرتبط بجدول حصص (timetable_entries). استخدم التعطيل بدلًا من ذلك.",
            code: "FK_BLOCK",
          });
        }
      }
    }

    await client.query(
      `DELETE FROM employees WHERE id=$1 AND school_id=$2`,
      [id, schoolId]
    );

    if (teacherId) {
      await client.query(
        `DELETE FROM teachers WHERE id=$1 AND school_id=$2`,
        [teacherId, schoolId]
      );
    }

    await client.query("COMMIT");
    return res.json({ ok: true, mode: "hard", message: "تم الحذف النهائي ✅" });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("employeeDelete error:", e);
    return res.status(500).json({ error: "فشل العملية" });
  } finally {
    client.release();
  }
};