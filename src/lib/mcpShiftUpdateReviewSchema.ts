import { z } from 'zod';

const id = z.string().uuid();
const dateTime = z.string().refine(value => Number.isFinite(Date.parse(value)));
const staff = z.object({ staff_id: id, staff_role_id: id.nullable().optional() });
const beforeSegment = z.object({
  id, start_at: dateTime, end_at: dateTime, sort_order: z.number(),
  service_type_id: id.nullable(), source_pattern_segment_id: id.nullable(), staffs: z.array(staff),
});
const proposedSegment = z.object({
  start_at: dateTime, end_at: dateTime, service_type_id: id.nullable().optional(), staffs: z.array(staff),
});
const named = z.object({ id, name: z.string().nullable() });
export const proposalSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('confirmation_required'), proposal_id: id, expires_at: dateTime,
    before: z.object({ id, title: z.string().nullable(), start_at: dateTime, end_at: dateTime,
      staffs: z.array(z.object({ staff_id: id })), segments: z.array(beforeSegment) }),
    proposal: z.object({ start_at: dateTime, end_at: dateTime, segments: z.array(proposedSegment) }),
    references: z.object({ organization: named, client: named, staffs: z.array(named), staff_roles: z.array(named), service_types: z.array(named) }),
  }),
  z.object({ status: z.literal('expired') }),
  z.object({ status: z.literal('changed') }),
  z.object({ status: z.literal('updated'), shift_id: id, google_sync_status: z.string().nullable() }),
]);

