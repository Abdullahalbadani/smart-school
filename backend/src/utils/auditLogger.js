// backend/src/utils/auditLogger.js
// غلاف متوافق مع الاستدعاءات القديمة، ويستخدم المسجل الموحد حتى لا تختلف
// جودة بيانات التدقيق بين الأحداث اليدوية والأحداث الآلية.
import { logActivity } from "./logger.js";

/**
 * تسجيل حدث إداري تفصيلي شامل في جدول activity_logs.
 * أبقينا أسماء الوسائط القديمة كما هي حتى تعمل جميع الاستدعاءات الموجودة دون كسر.
 */
export async function logAudit({
  req = null,
  action = "ACTIVITY",
  actionLabel = null,
  module = "System",
  moduleLabel = null,
  tableName = null,
  recordId = null,
  resourceType = null,
  resourceId = null,
  entityType = null,
  entityId = null,
  oldData = null,
  newData = null,
  changedFields = null,
  description = "",
  details = {},
  metadata = {},
  changes = {},
  reason = null,
  severity = null,
  result = null,
  eventKey = null,
  path = null,
  method = null,
  statusCode = null,
  schoolIdFallback = null,
  userIdFallback = null,
  userNameFallback = null,
  userRoleFallback = null,
} = {}) {
  return logActivity({
    req,
    school_id: schoolIdFallback,
    user_id: userIdFallback,
    user_name: userNameFallback,
    user_role: userRoleFallback,
    action,
    action_label: actionLabel,
    module,
    module_label: moduleLabel,
    table_name: tableName,
    record_id: recordId,
    resource_type: resourceType || entityType || tableName || module,
    resource_id: resourceId || entityId || recordId,
    entity_type: entityType || resourceType || tableName || module,
    entity_id: entityId || resourceId || recordId,
    old_data: oldData,
    new_data: newData,
    changed_fields: changedFields,
    description,
    details,
    metadata,
    changes,
    reason,
    severity,
    result,
    event_key: eventKey,
    path,
    method,
    status_code: statusCode,
  });
}

export default logAudit;
