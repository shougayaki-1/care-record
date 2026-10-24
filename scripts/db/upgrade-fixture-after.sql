DO $check$
DECLARE
 expected jsonb := (SELECT value FROM ci_upgrade_fixture.expected);
 actual jsonb := ci_upgrade_fixture.state();
 category text;
BEGIN
 -- New entries are allowed, but every old entry must survive without modification.
 FOR category IN SELECT jsonb_object_keys(expected) LOOP
  IF EXISTS (
   SELECT 1 FROM jsonb_array_elements(expected->category) old_entry
   WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(actual->category) new_entry
    -- Audit snapshots contain all original columns. Ignore only columns which
    -- did not exist in the baseline; compare original nested values exactly.
    WHERE (CASE WHEN category='audit' THEN new_entry.value - ARRAY(
      SELECT jsonb_object_keys(new_entry.value) EXCEPT SELECT jsonb_object_keys(old_entry.value)
    ) ELSE new_entry.value END) = old_entry.value
   )
  ) THEN
   RAISE EXCEPTION 'Migration changed or lost pre-existing synthetic %',category;
  END IF;
 END LOOP;
END $check$;
