This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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
