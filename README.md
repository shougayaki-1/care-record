This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Release readiness

- [Approved system decisions](docs/system-decisions.md)
- [Release readiness checklist](docs/release-readiness-checklist.md)
- [Implementation gap plan](docs/implementation-gap-plan.md)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Development and deployment flow

This project separates local development, staging, and production so that testing never uses production data or credentials.

| Environment | Database | Vercel project | Deployment trigger |
| --- | --- | --- | --- |
| Local | Local Supabase started by the CLI | None | `npm run dev` |
| Staging | `care-record-staging` (`xhvvfovvlqzlkirpjocv`) | `care-record-staging` | Push to `staging` |
| Production | Production Supabase project | `care-record` | Push or merge to `main` |

### Routine workflow

1. Create a feature branch from `staging` and develop locally.
2. Run the checks below locally.
3. Merge or push the validated change to `staging`. Vercel creates a Preview deployment in the `care-record-staging` project.
4. Verify the staging URL and, when database migrations are included, apply and verify those migrations on the staging Supabase project first.
5. Merge `staging` into `main` only after staging verification. This is the production release point.

```bash
npm run lint -- --max-warnings=0
npm run typecheck
npm run test:unit
npm run build
```

### Supabase migrations

Migrations are intentionally applied manually from a trusted local machine; the regular release flow does not depend on GitHub Actions.

Before applying a migration, link the CLI to the intended project and confirm the history. Never run these commands while linked to the wrong environment.

```bash
# Confirm local and remote migration history.
npx supabase migration list --linked

# Review what would be applied, then apply it.
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

Apply to staging first. Apply the same migration to production only after staging verification and with an up-to-date production backup.

### Environment variables

- Keep local secrets in `.env.local`; never commit that file.
- Configure staging values only in the `care-record-staging` Vercel project, under **Preview**.
- Configure production values only in the `care-record` Vercel project, under **Production**.
- Do not copy Supabase keys, service-role keys, or external-service secrets between the two projects.
- Staging currently disables paid/external integrations with `EXTERNAL_INTEGRATIONS_ENABLED=false` and `AI_IMPORT_ENABLED=false`.
- Production must use its own Supabase URL, anon key, service-role key, and `EXPECTED_SUPABASE_PROJECT_ID`.

The staging project uses Vercel's Git integration, so everyday staging deployments do not consume GitHub Actions minutes. Its Vercel setting builds pre-production branches only, preventing `main` from being deployed by the staging project. The manual GitHub Actions deployment workflow is retained for recovery only; do not use it for the normal release path while GitHub Actions billing is disabled.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Security-sensitive deployment steps

Before deploying an application build that uses the compliance foundation:

1. Apply `supabase/migrations/202606190001_compliance_foundation.sql` to the target Supabase project.
2. Configure all server-only variables documented in `.env.example`.
3. Generate `GOOGLE_TOKEN_ENCRYPTION_KEY` as a 32-byte random value encoded with base64.
4. Configure the GAS endpoint to reject requests unless the timestamp is recent, the nonce is unused, and `X-CareRecord-Signature` matches the HMAC-SHA256 signature made with `GAS_SHARED_SECRET`.
5. Deploy the application only after the migration and secrets are ready. The migration adds columns used by the updated server actions.

Do not expose `GAS_API_URL`, `GAS_SHARED_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY`, `AUDIT_IP_HASH_SALT`, or the Supabase service-role key with a `NEXT_PUBLIC_` prefix.
