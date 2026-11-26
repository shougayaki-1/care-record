import { encode, sha256, type ObjectRef } from '@/utils/auditArchive/contracts';

// Shared by the independent verifier and API. This binds every reference field,
// not just the content digest: an identical object at a different generation or
// path is a different operator-pinned trust anchor.
export function verificationControlDigest(environment: string, control: ObjectRef): string {
  return sha256(encode(['audit-verification-request:1', environment, control.name,
    control.generation, control.digest, control.size]));
}
