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
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(actual->category) new_entry WHERE new_entry.value=old_entry.value)
  ) THEN
   RAISE EXCEPTION 'Migration changed or lost pre-existing synthetic %',category;
  END IF;
 END LOOP;
END $check$;
