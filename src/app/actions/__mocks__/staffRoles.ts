import { fn } from 'storybook/test';
import type * as StaffRoles from '../staffRoles';

export const getStaffRoles = fn<typeof StaffRoles.getStaffRoles>().mockResolvedValue([]);
