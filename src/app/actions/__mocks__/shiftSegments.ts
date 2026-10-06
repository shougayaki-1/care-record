import { fn } from 'storybook/test';
import type * as ShiftSegments from '../shiftSegments';

export const getShiftSegments = fn<typeof ShiftSegments.getShiftSegments>().mockResolvedValue([]);
