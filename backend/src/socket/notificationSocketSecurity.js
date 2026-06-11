import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import UserModel from "../modules/userModel.js";

function parseCookies(rawCookie = "") {
  const out = {};
  for (const item of String(rawCookie || "").split(";")) {
    const index = item.indexOf("=");
    if (index <= 0) continue;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function extractSocketToken(socket) {
  const authToken = socket?.handshake?.auth?.token;
  if (authToken) return String(authToken).trim();

  const authorization = socket?.handshake?.headers?.authorization || "";
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) return match[1].trim();

  const cookies = parseCookies(socket?.handshake?.headers?.cookie || "");
  if (cookies.token) return String(cookies.token).trim();

  return null;
}

function isInactiveUser(user) {
  const status = String(user?.status || "").toLowerCase();
  return user?.is_active === false || ["inactive", "disabled", "suspended"].includes(status);
}

function isBlockedSchool(school) {
  if (!school || !school.is_active) return true;
  const subscriptionStatus = String(school.subscription_status || "").toLowerCase();
  if (["suspended", "cancelled", "expired"].includes(subscriptionStatus)) return true;

  const now = new Date();
  const trialExpired =
    subscriptionStatus === "trial" &&
    school.trial_ends_at &&
    new Date(school.trial_ends_at) < now;

  const subscriptionExpired =
    subscriptionStatus === "active" &&
    String(school.subscription_plan || "").toLowerCase() !== "lifetime" &&
    school.subscription_ends_at &&
    new Date(school.subscription_ends_at) < now;

  return !!(trialExpired || subscriptionExpired);
}

async function getTeacherIdsForUser(userId, schoolId) {
  const { rows } = await pool.query(
    `SELECT id
     FROM teachers
     WHERE user_id = $1
       AND school_id = $2
       AND COALESCE(is_active, true) = true`,
    [userId, schoolId]
  );

  return rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

async function authenticateSocket(socket) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error("server_configuration_error");

  const token = extractSocketToken(socket);
  if (!token) throw new Error("missing_token");

  let decoded;
  try {
    decoded = jwt.verify(token, jwtSecret);
  } catch {
    throw new Error("invalid_or_expired_token");
  }

  const userId = Number(decoded?.id);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("invalid_token_payload");

  const user = await UserModel.getById(userId);
  if (!user || isInactiveUser(user)) throw new Error("inactive_or_missing_user");

  const currentTokenVersion = Number(user.token_version ?? 0);
  if (
    decoded.tokenVersion == null ||
    Number(decoded.tokenVersion) !== currentTokenVersion
  ) {
    throw new Error("stale_token");
  }

  const schoolId = Number(user.school_id);
  if (!Number.isInteger(schoolId) || schoolId <= 0) throw new Error("missing_school");

  const { rows } = await pool.query(
    `SELECT
       id,
       is_active,
       subscription_status,
       subscription_plan,
       trial_ends_at,
       subscription_ends_at
     FROM schools
     WHERE id = $1
     LIMIT 1`,
    [schoolId]
  );

  const school = rows[0];
  if (isBlockedSchool(school)) throw new Error("inactive_or_expired_school");

  const teacherIds = await getTeacherIdsForUser(userId, schoolId);

  return {
    userId,
    schoolId,
    teacherIds,
    roleId: user.role_id ? Number(user.role_id) : null,
    roleName: user.role_name || null,
  };
}

function acknowledge(ack, payload) {
  if (typeof ack === "function") ack(payload);
}

/**
 * Socket.IO hardening for notifications and real-time school events.
 * Rooms are calculated from the verified JWT. Clients cannot subscribe to
 * another user's or another school's private room.
 */
export function configureNotificationSockets(io) {
  io.use(async (socket, next) => {
    try {
      socket.data.auth = await authenticateSocket(socket);
      next();
    } catch (error) {
      const err = new Error("غير مصرح بالاتصال اللحظي");
      err.data = { code: error.message || "SOCKET_AUTH_FAILED" };
      next(err);
    }
  });

  io.on("connection", (socket) => {
    const auth = socket.data.auth;
    socket.join(`school_${auth.schoolId}`);
    socket.join(`user_${auth.userId}`);
    for (const teacherId of auth.teacherIds) socket.join(`teacher_${teacherId}`);

    // Compatibility only. A client may request its own room again, never another room.
    socket.on("join_user_room", (requestedUserId, ack) => {
      const requested = Number(requestedUserId);
      const allowed = requested === auth.userId;
      if (allowed) socket.join(`user_${auth.userId}`);
      acknowledge(ack, { ok: allowed });
    });

    socket.on("join_teacher_room", (requestedTeacherId, ack) => {
      const requested = Number(requestedTeacherId);
      const allowed = auth.teacherIds.includes(requested);
      if (allowed) socket.join(`teacher_${requested}`);
      acknowledge(ack, { ok: allowed });
    });

    socket.on("join_school_room", (_requestedSchoolId, ack) => {
      // The verified school room is joined automatically. Never trust a client-supplied school id.
      socket.join(`school_${auth.schoolId}`);
      acknowledge(ack, { ok: true, school_id: auth.schoolId });
    });
  });
}
