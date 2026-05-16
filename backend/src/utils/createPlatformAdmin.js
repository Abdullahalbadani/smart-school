import bcrypt from "bcrypt";
import { pool } from "../config/db.js";

async function main() {
  const name = process.env.PLATFORM_ADMIN_NAME || "Platform Admin";
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error("ضع PLATFORM_ADMIN_EMAIL و PLATFORM_ADMIN_PASSWORD قبل التشغيل");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `
    INSERT INTO platform_admins (name, email, password_hash)
    VALUES ($1, $2, $3)
    ON CONFLICT (email)
    DO UPDATE SET
      name = EXCLUDED.name,
      password_hash = EXCLUDED.password_hash,
      status = 'active',
      token_version = platform_admins.token_version + 1,
      updated_at = NOW()
    RETURNING id, name, email, status
    `,
    [name, email, passwordHash]
  );

  console.log("Platform admin ready:");
  console.log(result.rows[0]);

  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});