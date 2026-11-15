/**
 * Security Rules Verification Specification for /records/{recordId}
 * Verifies all 12 "Dirty Dozen" adversarial payloads documented in security_spec.md
 */

export interface TestPayload {
  name: string;
  docId: string;
  operation: 'create' | 'update' | 'get' | 'delete';
  data?: Record<string, unknown>;
  existingData?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED' | 'ALLOWED';
}

export const dirtyDozenPayloads: TestPayload[] = [
  {
    name: '1. Shadow Field Injection',
    docId: 'r1',
    operation: 'create',
    data: { id: 'r1', type: 'user', name: 'ABA1001', isAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '2. Oversized Document ID',
    docId: 'a'.repeat(500),
    operation: 'create',
    data: { id: 'a'.repeat(500), type: 'user' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '3. Invalid ID Characters',
    docId: 'bad$id with spaces',
    operation: 'create',
    data: { id: 'bad$id with spaces', type: 'user' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '4. Mismatched Payload ID',
    docId: 'r1',
    operation: 'create',
    data: { id: 'r2', type: 'user', name: 'ABA1001' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '5. Invalid Record Type',
    docId: 'r1',
    operation: 'create',
    data: { id: 'r1', type: 'superadmin' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '6. Oversized Name String',
    docId: 'r1',
    operation: 'create',
    data: { id: 'r1', type: 'user', name: 'X'.repeat(500) },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '7. Wrong Type for maxHours',
    docId: 't1',
    operation: 'create',
    data: { id: 't1', type: 'teacher', name: 'CIKGU A', subject: 'CG A', maxHours: 'thirty' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '8. Out-of-Bounds maxHours',
    docId: 't1',
    operation: 'create',
    data: { id: 't1', type: 'teacher', name: 'CIKGU A', subject: 'CG A', maxHours: 9999 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '9. Invalid Class Level',
    docId: 'c1',
    operation: 'create',
    data: { id: 'c1', type: 'class', name: '1 CERDIK', level: 'Tahap 99' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '10. Immutable Type Mutation on Update',
    docId: 't1',
    operation: 'update',
    existingData: { id: 't1', type: 'teacher', name: 'CIKGU A' },
    data: { id: 't1', type: 'user', name: 'CIKGU A' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '11. Immutable ID Mutation on Update',
    docId: 't1',
    operation: 'update',
    existingData: { id: 't1', type: 'teacher', name: 'CIKGU A' },
    data: { id: 't2', type: 'teacher', name: 'CIKGU A' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    name: '12. Unprotected Catch-All Collection Write',
    docId: 'doc1',
    operation: 'create',
    data: { id: 'doc1', type: 'user' },
    expectedResult: 'PERMISSION_DENIED',
  },
];
