output "backup_bucket" {
  value = google_storage_bucket.primary.name
}

output "replica_bucket" {
  value = google_storage_bucket.replica.name
}

output "tier_backup_buckets" {
  value = { for tier, days in local.backup_tiers : tier => google_storage_bucket.tier["${tier}-tokyo"].name if var.enable_tiered_backups }
}

output "tier_replica_buckets" {
  value = { for tier, days in local.backup_tiers : tier => google_storage_bucket.tier["${tier}-osaka"].name if var.enable_tiered_backups }
}

output "audit_bucket" {
  value = google_storage_bucket.audit.name
}

output "workload_identity_provider" {
  value = google_iam_workload_identity_pool_provider.github.name
}

output "backup_service_account" {
  value = google_service_account.github_backup.email
}

output "bucket_lock_enabled" {
  value       = var.enable_bucket_lock
  description = "True means retention locks were requested. Locking is irreversible."
}
