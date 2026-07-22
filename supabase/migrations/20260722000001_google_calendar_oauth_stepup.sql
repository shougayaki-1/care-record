-- Google SSO-only users complete step-up authentication in the Calendar OAuth
-- authorization itself. Keep this flag with the one-time nonce so the callback
-- can enforce an ID-token subject match without trusting browser state.
ALTER TABLE public.oauth_nonces
  ADD COLUMN IF NOT EXISTS requires_google_identity_match boolean NOT NULL DEFAULT false;
