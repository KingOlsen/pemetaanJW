# Security Specification — Sistem Pemetaan Jadual (Premium)

## 1. Data Invariants
1. Every document in `/records/{recordId}` must have a valid alphanumeric/hyphen/underscore ID (`^[a-zA-Z0-9_\-]+$`, max 128 chars) and `incoming().id == recordId`.
2. Every record must specify a valid `type` in `['user', 'teacher', 'class', 'subject', 'assignment']`.
3. Only allowed schema keys (`id`, `type`, `name`, `username`, `role`, `subject`, `maxHours`, `level`, `class_id`, `subject_id`, `teacher_id`) may be present; shadow/ghost fields are strictly rejected.
4. String fields (`name`, `username`, `role`, `subject`, `class_id`, `subject_id`, `teacher_id`) are strictly bounded in length (`<= 200` or `<= 128`).
5. Numeric field `maxHours` (when present) must be an integer/number between 1 and 100.

## 2. The "Dirty Dozen" Payloads
1. **Shadow Field Injection**: `{ id: "r1", type: "user", name: "ABA1001", isAdmin: true }` -> Rejected by `hasOnly()`.
2. **Oversized Document ID**: `recordId` of 500 characters -> Rejected by `isValidId(recordId)`.
3. **Invalid ID Characters**: `recordId` containing spaces or `$` -> Rejected by `isValidId(recordId)`.
4. **Mismatched Payload ID**: `recordId == "r1"` with `{ id: "r2", type: "user" }` -> Rejected by `data.id == recordId`.
5. **Invalid Record Type**: `{ id: "r1", type: "superadmin" }` -> Rejected by `data.type in ['user', 'teacher', 'class', 'subject', 'assignment']`.
6. **Oversized Name String**: `name` of 5,000 chars -> Rejected by `data.name.size() <= 200`.
7. **Wrong Type for `maxHours`**: `{ id: "t1", type: "teacher", name: "A", subject: "B", maxHours: "thirty" }` -> Rejected by `data.maxHours is number`.
8. **Out-of-Bounds `maxHours`**: `{ id: "t1", type: "teacher", name: "A", subject: "B", maxHours: 9999 }` -> Rejected by `data.maxHours >= 1 && data.maxHours <= 100`.
9. **Invalid Class Level**: `{ id: "c1", type: "class", name: "1A", level: "Tahap 99" }` -> Rejected by `data.level in ['Tahap 1', 'Tahap 2']`.
10. **Immutable Type Mutation on Update**: Updating `type` from `'teacher'` to `'user'` -> Rejected by `incoming().type == existing().type`.
11. **Immutable ID Mutation on Update**: Updating `id` on an existing document -> Rejected by `incoming().id == existing().id`.
12. **Unprotected Catch-All Collection Write**: Writing to `/otherCollection/doc1` -> Rejected by global default-deny rule.
