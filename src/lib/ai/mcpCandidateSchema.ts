import { z } from 'zod';

/** Validate MCP-submitted candidates without loading the server-only AI SDK in the browser. */
export const RawExtractionResponseSchema = z.object({
  records: z.array(z.object({
    meta: z.object({
      date: z.string().nullable(),
      start_at: z.string().nullable(),
      end_at: z.string().nullable(),
      client_name: z.string().nullable(),
      helper_names: z.array(z.string()),
      client_id_candidate: z.string().nullable(),
      helper_id_candidates: z.array(z.string()),
      travel_time_hours: z.number().finite().nonnegative().nullable().optional(),
    }),
    values: z.record(z.string(), z.unknown()),
    confidence: z.enum(['high', 'medium', 'low']),
    warnings: z.array(z.string()),
  })),
});

export type RawExtractionResult = z.infer<typeof RawExtractionResponseSchema>['records'][number];
