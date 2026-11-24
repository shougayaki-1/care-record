locals {
  backup_tiers = {
    recent  = 2
    daily   = 8
    weekly  = 32
    monthly = var.backup_retention_days
  }
  tier_transfer_intervals = {
    recent  = "21600s"
    daily   = "86400s"
    weekly  = "86400s"
    monthly = "86400s"
  }
  tier_buckets = var.enable_tiered_backups ? merge([
    for tier, days in local.backup_tiers : {
      for region in ["tokyo", "osaka"] : "${tier}-${region}" => {
        tier     = tier
        days     = days
        location = region == "tokyo" ? var.primary_region : var.replica_region
      }
    }
  ]...) : {}
  tier_transfer_roles = merge([
    for key, config in local.tier_buckets : {
      "${key}-objects" = { key = key, role = "roles/storage.objectViewer" }
      "${key}-bucket"  = { key = key, role = "roles/storage.legacyBucketReader" }
    }
  ]...)
}

# Additive migration: the original buckets and their locks remain in place.
# Separate buckets make each tier's minimum retention enforceable, including
# monthly's seven years, without locking daily/weekly objects for seven years.
resource "google_storage_bucket" "tier" {
  for_each = local.tier_buckets

  name                        = "${local.name_prefix}-${each.key}"
  project                     = var.project_id
  location                    = each.value.location
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  lifecycle { prevent_destroy = true }
  versioning { enabled = false }
  soft_delete_policy { retention_duration_seconds = 0 }

  retention_policy {
    retention_period = each.value.days * 86400
    is_locked        = var.enable_tier_bucket_lock
  }

  lifecycle_rule {
    action { type = "Delete" }
    condition { age = each.value.days }
  }

  # Short tiers remain Standard: Nearline/Archive minimum durations would
  # charge for storage beyond their useful lifetime. Monthly lives >=7 years.
  dynamic "lifecycle_rule" {
    for_each = each.value.tier == "monthly" ? [1] : []
    content {
      action {
        type          = "SetStorageClass"
        storage_class = "ARCHIVE"
      }
      condition { age = 90 }
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket_iam_member" "tier_backup_create" {
  for_each = { for key, config in local.tier_buckets : key => config if endswith(key, "-tokyo") }
  bucket   = google_storage_bucket.tier[each.key].name
  role     = "roles/storage.objectCreator"
  member   = "serviceAccount:${google_service_account.github_backup.email}"
}

resource "google_storage_bucket_iam_member" "tier_backup_read" {
  for_each = local.tier_buckets
  bucket   = google_storage_bucket.tier[each.key].name
  role     = "roles/storage.objectViewer"
  member   = "serviceAccount:${google_service_account.github_backup.email}"
}

resource "google_storage_bucket_iam_member" "tier_transfer_read" {
  for_each = local.tier_transfer_roles
  bucket   = google_storage_bucket.tier[each.value.key].name
  role     = each.value.role
  member   = "serviceAccount:${data.google_storage_transfer_project_service_account.transfer.email}"
}

resource "google_storage_bucket_iam_member" "tier_transfer_create" {
  for_each = { for key, config in local.tier_buckets : key => config if endswith(key, "-osaka") }
  bucket   = google_storage_bucket.tier[each.key].name
  role     = "roles/storage.objectCreator"
  member   = "serviceAccount:${data.google_storage_transfer_project_service_account.transfer.email}"
}

resource "google_storage_transfer_job" "tier_tokyo_to_osaka" {
  for_each    = var.enable_tiered_backups ? local.backup_tiers : {}
  project     = var.project_id
  description = "CareRecord ${var.environment} ${each.key} immutable backup replication"
  status      = "ENABLED"

  transfer_spec {
    gcs_data_source { bucket_name = google_storage_bucket.tier["${each.key}-tokyo"].name }
    gcs_data_sink { bucket_name = google_storage_bucket.tier["${each.key}-osaka"].name }
    transfer_options {
      overwrite_objects_already_existing_in_sink = false
      delete_objects_unique_in_sink              = false
      delete_objects_from_source_after_transfer  = false
    }
  }

  schedule {
    schedule_start_date {
      year  = var.replication_start_date.year
      month = var.replication_start_date.month
      day   = var.replication_start_date.day
    }
    start_time_of_day {
      hours   = 18
      minutes = 0
      seconds = 0
      nanos   = 0
    }
    # Storage Transfer's schedule is an interval between scheduled starts;
    # start_time_of_day does not guarantee the operation's actual start time.
    # Run recent every six hours to absorb backup and transfer start delays.
    repeat_interval = local.tier_transfer_intervals[each.key]
  }

  depends_on = [
    google_project_iam_member.transfer_service_agent,
    google_storage_bucket_iam_member.tier_transfer_read,
    google_storage_bucket_iam_member.tier_transfer_create,
  ]
}
