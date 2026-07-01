-- アカウントアイコン用のプロフィール列と Storage bucket を明示的に用意する。
-- アップロードは Server Action の service role 経由に限定し、表示は公開 URL で行う。

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  10485760,
  ARRAY['image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Deny direct avatar changes" ON storage.objects;
CREATE POLICY "Deny direct avatar changes"
  ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'avatars');

DROP POLICY IF EXISTS "Deny direct avatar updates" ON storage.objects;
CREATE POLICY "Deny direct avatar updates"
  ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'avatars')
  WITH CHECK (bucket_id <> 'avatars');

DROP POLICY IF EXISTS "Deny direct avatar deletes" ON storage.objects;
CREATE POLICY "Deny direct avatar deletes"
  ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'avatars');
