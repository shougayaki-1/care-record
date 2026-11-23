-- Resolve the correlated path against the Storage object, not clients.name.
DROP POLICY IF EXISTS "Authorized report image signed read" ON storage.objects;
CREATE POLICY "Authorized report image signed read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'report-images'
    AND (SELECT private.is_session_active())
    AND array_length(storage.foldername(name), 1) = 2
    AND storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
    AND EXISTS (
      SELECT 1 FROM public.reports r
      JOIN public.clients c ON c.id = r.client_id
      WHERE c.organization_id::text = (storage.foldername(objects.name))[1]
        AND r.id::text = (storage.foldername(objects.name))[2]
        AND r.deleted_at IS NULL
        AND private.can_record_action_for_client(c.organization_id, c.id, 'view')
    )
  );
