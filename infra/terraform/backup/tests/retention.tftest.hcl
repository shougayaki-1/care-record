mock_provider "google" {}

variables {
  project_id        = "care-record-test"
  environment       = "staging"
  github_repository = "fixture/care-record"
}

run "legacy_default" {
  command = plan

  assert {
    condition     = length(google_storage_bucket.tier) == 0 && length(google_storage_transfer_job.tier_tokyo_to_osaka) == 0
    error_message = "Tiered migration must be opt-in."
  }
  assert {
    condition     = tonumber(google_storage_bucket.primary.retention_policy[0].retention_period) == 2555 * 86400 && tonumber(google_storage_bucket.replica.retention_policy[0].retention_period) == 2555 * 86400
    error_message = "Legacy retention must remain seven years."
  }
}

run "additive_tiers" {
  command = plan
  variables {
    enable_tiered_backups = true
    enable_bucket_lock    = true
  }

  assert {
    condition     = length(google_storage_bucket.tier) == 8 && length(google_storage_transfer_job.tier_tokyo_to_osaka) == 4
    error_message = "All four tiers need Tokyo and Osaka buckets and replication."
  }
  assert {
    condition = alltrue([
      for key, bucket in google_storage_bucket.tier :
      tonumber(bucket.retention_policy[0].retention_period) == ({ recent = 2, daily = 8, weekly = 32, monthly = 2555 })[local.tier_buckets[key].tier] * 86400 &&
      !bucket.retention_policy[0].is_locked && !bucket.versioning[0].enabled &&
      bucket.soft_delete_policy[0].retention_duration_seconds == 0 &&
      !bucket.force_destroy && bucket.public_access_prevention == "enforced" &&
      bucket.uniform_bucket_level_access && upper(bucket.location) == upper(local.tier_buckets[key].location) &&
      anytrue([for rule in bucket.lifecycle_rule : one(rule.action).type == "Delete" && one(rule.condition).age == ({ recent = 2, daily = 8, weekly = 32, monthly = 2555 })[local.tier_buckets[key].tier]])
    ])
    error_message = "Tier retention, lifecycle, region, access and cost controls must match."
  }
  assert {
    condition = alltrue([
      for tier, job in google_storage_transfer_job.tier_tokyo_to_osaka :
      job.transfer_spec[0].gcs_data_source[0].bucket_name == google_storage_bucket.tier["${tier}-tokyo"].name &&
      job.transfer_spec[0].gcs_data_sink[0].bucket_name == google_storage_bucket.tier["${tier}-osaka"].name &&
      !job.transfer_spec[0].transfer_options[0].delete_objects_unique_in_sink &&
      !job.transfer_spec[0].transfer_options[0].delete_objects_from_source_after_transfer &&
      !job.transfer_spec[0].transfer_options[0].overwrite_objects_already_existing_in_sink &&
      job.schedule[0].repeat_interval == ({ recent = "21600s", daily = "86400s", weekly = "86400s", monthly = "86400s" })[tier]
    ])
    error_message = "Recent must replicate every six hours; other tiers remain daily and all jobs must preserve immutable replicas."
  }
  assert {
    condition = (
      google_storage_bucket.primary.retention_policy[0].is_locked &&
      google_storage_bucket.replica.retention_policy[0].is_locked &&
      tonumber(google_storage_bucket.audit.retention_policy[0].retention_period) == 3653 * 86400 &&
      google_storage_bucket.audit.retention_policy[0].is_locked &&
      google_storage_bucket.primary.name == "${local.name_prefix}-backup-tokyo" &&
      google_storage_bucket.replica.name == "${local.name_prefix}-backup-osaka"
    )
    error_message = "Existing names, locks and audit retention must be preserved."
  }
}

run "monthly_minimum" {
  command = plan
  variables {
    backup_retention_days = 2554
  }
  expect_failures = [var.backup_retention_days]
}
