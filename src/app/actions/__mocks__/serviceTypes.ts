import { fn } from 'storybook/test';
import type * as ServiceTypes from '../serviceTypes';

export const getServiceTypes = fn<typeof ServiceTypes.getServiceTypes>().mockResolvedValue([]);
