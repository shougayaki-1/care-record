terraform {
  required_version = ">= 1.7.0"
  backend "gcs" {}
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}
provider "google" { project = var.project_id }
locals {
  bucket_name = "${var.bucket_name_prefix}-${var.environment}-${substr(md5(var.project_id), 0, 8)}-audit-archive-10y"
  prefix = {
    writer   = "archive/${var.environment}/"
    verifier = "verification/${var.environment}/"
    control  = "control/${var.environment}/"
  }
  read_prefixes = {
    writer   = [local.prefix.writer, local.prefix.control]
    verifier = [local.prefix.writer, local.prefix.verifier, local.prefix.control]
    control  = [local.prefix.writer, local.prefix.control]
  }
}
resource "google_storage_bucket" "audit" {
  name                        = local.bucket_name
  project                     = var.project_id
  location                    = "ASIA-NORTHEAST1"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  storage_class               = "STANDARD"
  force_destroy               = false
  retention_policy {
    retention_period = 3653 * 86400
    is_locked        = var.enable_bucket_lock
  }
  # No deletion lifecycle. Existing seven-year buckets are outside this state.
  lifecycle { prevent_destroy = true }
}
resource "google_service_account" "audit" {
  for_each     = local.prefix
  project      = var.project_id
  account_id   = "cr-audit-${each.key}-${var.environment}"
  display_name = "Audit ${each.key} ${var.environment}"
}
resource "google_project_iam_custom_role" "create" {
  project     = var.project_id
  role_id     = "auditArchiveCreate${title(var.environment)}"
  title       = "Audit create only ${var.environment}"
  permissions = ["storage.objects.create"]
}
resource "google_project_iam_custom_role" "get" {
  project     = var.project_id
  role_id     = "auditArchiveGet${title(var.environment)}"
  title       = "Audit exact object read ${var.environment}"
  permissions = ["storage.objects.get"]
}
resource "google_project_iam_custom_role" "list" {
  project     = var.project_id
  role_id     = "auditArchiveList${title(var.environment)}"
  title       = "Audit receipt enumeration ${var.environment}"
  permissions = ["storage.objects.list"]
}
resource "google_storage_bucket_iam_member" "create" {
  for_each = local.prefix
  bucket   = google_storage_bucket.audit.name
  role     = google_project_iam_custom_role.create.name
  member   = "serviceAccount:${google_service_account.audit[each.key].email}"
  condition {
    title      = "create_${each.key}_prefix"
    expression = "resource.name.startsWith('projects/_/buckets/${local.bucket_name}/objects/${each.value}')"
  }
}
resource "google_storage_bucket_iam_member" "get" {
  for_each = local.read_prefixes
  bucket   = google_storage_bucket.audit.name
  role     = google_project_iam_custom_role.get.name
  member   = "serviceAccount:${google_service_account.audit[each.key].email}"
  condition {
    title      = "get_${each.key}_prefixes"
    expression = join(" || ", [for prefix in each.value : "resource.name.startsWith('projects/_/buckets/${local.bucket_name}/objects/${prefix}')"])
  }
}
# List is bucket-scoped; it cannot reliably be confined with object-prefix CEL.
# This bucket contains only this environment's audit evidence.
resource "google_storage_bucket_iam_member" "list" {
  for_each = local.prefix
  bucket   = google_storage_bucket.audit.name
  role     = google_project_iam_custom_role.list.name
  member   = "serviceAccount:${google_service_account.audit[each.key].email}"
}
resource "google_service_account_iam_member" "workload" {
  for_each           = var.workload_members
  service_account_id = google_service_account.audit[each.key].name
  role               = "roles/iam.workloadIdentityUser"
  member             = each.value
}
output "bucket_name" { value = google_storage_bucket.audit.name }
output "service_accounts" { value = { for role, account in google_service_account.audit : role => account.email } }
