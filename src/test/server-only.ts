// Next.js resolves `server-only` during its own build. Vitest runs source modules
// directly, so unit tests alias that side-effect-only import to this empty stub.
export {};
