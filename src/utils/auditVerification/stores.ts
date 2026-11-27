import { ArchiveFailure, type Store } from '@/utils/auditArchive/contracts';

// These guards limit accidental use by this process; bucket IAM must enforce
// the same separation independently, including for compromised credentials.
export function verificationStores(environment: 'local' | 'staging' | 'production', archive: Store, receipts: Store) {
  const archivePrefixes = [`archive/${environment}/`, `control/${environment}/`];
  const allowedArchive = (name: string) => archivePrefixes.some(prefix => name.startsWith(prefix))
    && !name.split('/').some(part => part === '.' || part === '..');
  const receiptPattern = new RegExp(`^verification/${environment}/runs/[1-9][0-9]{0,19}/[1-9][0-9]{0,5}\\.json$`);
  const deny = () => { throw new ArchiveFailure('mismatch'); };
  const archiveStore: Store = {
    async list(prefix, cursor) {
      if (!allowedArchive(prefix)) return deny();
      const result = await archive.list(prefix, cursor);
      if (result.names.some(name => !name.startsWith(prefix) || !allowedArchive(name))) return deny();
      return result;
    },
    async read(name, generation) {
      if (!allowedArchive(name)) return deny();
      return archive.read(name, generation);
    },
    async create() { return deny(); },
  };
  const receiptStore: Store = {
    async list() { return deny(); },
    async read(name, generation) {
      if (!receiptPattern.test(name)) return deny();
      return receipts.read(name, generation);
    },
    async create(name, bytes) {
      if (!receiptPattern.test(name)) return deny();
      return receipts.create(name, bytes);
    },
  };
  return { archiveStore, receiptStore };
}
