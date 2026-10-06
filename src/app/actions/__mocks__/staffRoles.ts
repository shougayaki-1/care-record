import { fn } from 'storybook/test';
import type * as StaffRoles from '../staffRoles';

export const getStaffRoles = fn<typeof StaffRoles.getStaffRoles>().mockResolvedValue({ ok: true, data: [] });
export const createStaffRole = fn<typeof StaffRoles.createStaffRole>().mockResolvedValue({ ok: true, data: undefined });
export const updateStaffRole = fn<typeof StaffRoles.updateStaffRole>().mockResolvedValue({ ok: true, data: undefined });
export const deleteStaffRole = fn<typeof StaffRoles.deleteStaffRole>().mockResolvedValue({ ok: true, data: undefined });
