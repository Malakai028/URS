export type ActionStatus =
  | "pending"
  | "success"
  | "rejected"
  | "failed"
  | "unavailable"
  | "invalid-target"
  | "insufficient-resource"
  | "out-of-range"
  | "unauthorized";

export function rejectionStatus(status: number, message: string): ActionStatus {
  if (status === 401 || status === 403) return "unauthorized";
  if (/вне дистанции/i.test(message)) return "out-of-range";
  if (/цель/i.test(message)) return "invalid-target";
  if (/Недостаточно|перегружен|грузоподъёмность/i.test(message))
    return "insufficient-resource";
  if (/Подойдите|рядом|дистанци/i.test(message)) return "out-of-range";
  if (/восстанавливается|Требуется уровень|обессилен|закрыта/i.test(message))
    return "unavailable";
  return status >= 500 || !status ? "failed" : "rejected";
}
