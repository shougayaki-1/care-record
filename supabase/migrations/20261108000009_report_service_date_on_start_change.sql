-- Keep the search date and the version snapshot aligned when a report moves
-- to another calendar day. Existing rows are not rewritten by this migration.
create function private.sync_report_service_date_on_start_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (old.start_at at time zone 'Asia/Tokyo')::date is distinct from
     (new.start_at at time zone 'Asia/Tokyo')::date then
    new.service_date := (new.start_at at time zone 'Asia/Tokyo')::date;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_report_service_date_on_start_change() from public, anon, authenticated, service_role;

create trigger reports_sync_service_date_on_start_change
before update of start_at on public.reports
for each row execute function private.sync_report_service_date_on_start_change();
