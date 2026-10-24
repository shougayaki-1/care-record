import { fn } from 'storybook/test';
import type * as Backup from '../backup';

export const listDailyBackups = fn<typeof Backup.listDailyBackups>().mockResolvedValue({ ok: true, data: { configured: true, files: [] } });
export const getBackupRecords = fn<typeof Backup.getBackupRecords>().mockResolvedValue({ ok: true, data: [] });
export const getLastBackupRun = fn<typeof Backup.getLastBackupRun>().mockResolvedValue({ ok: true, data: null });
export const triggerDailyBackup = fn<typeof Backup.triggerDailyBackup>();
