locals {
  # Project hash keeps globally unique bucket names below GCS's 63-character limit.
  name_prefix = "${var.bucket_name_prefix}-${var.environment}-${substr(md5(var.project_id), 0, 8)}"
}

resource "google_project_service" "required" {
  for_each = toset([
    "cloudresourcemanager.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "storage.googleapis.com",
    "storagetransfer.googleapis.com",
  ])

  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_storage_bucket" "primary" {
  name                        = "${local.name_prefix}-backup-tokyo"
  project                     = var.project_id
  location                    = var.primary_region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  retention_policy {
    retention_period = var.backup_retention_days * 86400
    is_locked        = var.enable_bucket_lock
  }

  lifecycle_rule {
    action {
      type          = "SetStorageClass"
      storage_class = "ARCHIVE"
    }
    condition {
      age = 90
    }
  }

  lifecycle_rule {
    action { type = "Delete" }
    condition {
      age = var.backup_retention_days
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "replica" {
  name                        = "${local.name_prefix}-backup-osaka"
  project                     = var.project_id
  location                    = var.replica_region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning { enabled = true }

  retention_policy {
    retention_period = var.backup_retention_days * 86400
    is_locked        = var.enable_bucket_lock
  }

  lifecycle_rule {
    action {
      type          = "SetStorageClass"
      storage_class = "ARCHIVE"
    }
    condition { age = 90 }
  }

  lifecycle_rule {
    action { type = "Delete" }
    condition { age = var.backup_retention_days }
  }

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "audit" {
  name                        = "${local.name_prefix}-audit-worm"
  project                     = var.project_id
  location                    = var.primary_region
  storage_class               = "ARCHIVE"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning { enabled = true }

  retention_policy {
    retention_period = var.audit_retention_days * 86400
    is_locked        = var.enable_bucket_lock
  }

  lifecycle_rule {
    action { type = "Delete" }
    condition { age = var.audit_retention_days }
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "github_backup" {
  project      = var.project_id
  account_id   = "cr-backup-${var.environment}"
  display_name = "CareRecord ${var.environment} GitHub backup"
}

resource "google_storage_bucket_iam_member" "backup_create" {
  bucket = google_storage_bucket.primary.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.github_backup.email}"
}

resource "google_storage_bucket_iam_member" "backup_read" {
  bucket = google_storage_bucket.primary.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.github_backup.email}"
}

resource "google_storage_bucket_iam_member" "replica_read" {
  bucket = google_storage_bucket.replica.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.github_backup.email}"
}

resource "google_storage_bucket_iam_member" "audit_create" {
  bucket = google_storage_bucket.audit.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.github_backup.email}"
}

resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "cr-github-${var.environment}"
  display_name              = "CareRecord GitHub ${var.environment}"
  depends_on                = [google_project_service.required]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub Actions"

  attribute_mapping = {
    "google.subject"             = "assertion.sub"
    "attribute.repository"       = "assertion.repository"
    "attribute.repository_owner" = "assertion.repository_owner"
    "attribute.ref"              = "assertion.ref"
  }

  attribute_condition = "assertion.repository == '${var.github_repository}' && assertion.ref in ${jsonencode(sort(tolist(var.github_refs)))}"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_oidc" {
  service_account_id = google_service_account.github_backup.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

data "google_storage_transfer_project_service_account" "transfer" {
  project    = var.project_id
  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "transfer_service_agent" {
  project = var.project_id
  role    = "roles/storagetransfer.serviceAgent"
  member  = "serviceAccount:${data.google_storage_transfer_project_service_account.transfer.email}"
}

resource "google_storage_bucket_iam_member" "transfer_source_read" {
  bucket = google_storage_bucket.primary.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${data.google_storage_transfer_project_service_account.transfer.email}"
}

resource "google_storage_bucket_iam_member" "transfer_source_bucket_read" {
  bucket = google_storage_bucket.primary.name
  role   = "roles/storage.legacyBucketReader"
  member = "serviceAccount:${data.google_storage_transfer_project_service_account.transfer.email}"
}

resource "google_storage_bucket_iam_member" "transfer_replica_write" {
  bucket = google_storage_bucket.replica.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${data.google_storage_transfer_project_service_account.transfer.email}"
}

resource "google_storage_bucket_iam_member" "transfer_replica_bucket_read" {
  bucket = google_storage_bucket.replica.name
  role   = "roles/storage.legacyBucketReader"
  member = "serviceAccount:${data.google_storage_transfer_project_service_account.transfer.email}"
}

resource "google_storage_transfer_job" "tokyo_to_osaka" {
  project     = var.project_id
  description = "CareRecord ${var.environment} daily immutable backup replication"
  status      = "ENABLED"

  transfer_spec {
    gcs_data_source { bucket_name = google_storage_bucket.primary.name }
    gcs_data_sink { bucket_name = google_storage_bucket.replica.name }

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
    repeat_interval = "86400s"
  }

  depends_on = [
    google_project_iam_member.transfer_service_agent,
    google_storage_bucket_iam_member.transfer_source_read,
    google_storage_bucket_iam_member.transfer_source_bucket_read,
    google_storage_bucket_iam_member.transfer_replica_write,
    google_storage_bucket_iam_member.transfer_replica_bucket_read,
  ]
}
