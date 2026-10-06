import { fn } from 'storybook/test';
import type * as ServiceTypes from '../serviceTypes';

export const getServiceTypes = fn<typeof ServiceTypes.getServiceTypes>().mockResolvedValue({ ok: true, data: [] });
export const createServiceType = fn<typeof ServiceTypes.createServiceType>().mockResolvedValue({ ok: true, data: undefined });
export const updateServiceType = fn<typeof ServiceTypes.updateServiceType>().mockResolvedValue({ ok: true, data: undefined });
export const deleteServiceType = fn<typeof ServiceTypes.deleteServiceType>().mockResolvedValue({ ok: true, data: undefined });
