/** Expected states cross the Server Action boundary as plain data, never as thrown errors. */
export type ActionResult<T, Code extends string> =
  | { ok: true; data: T }
  | { ok: false; error: { code: Code; message: string } };
