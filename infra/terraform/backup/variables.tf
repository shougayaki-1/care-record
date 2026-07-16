variable "project_id" {
  description = "Google Cloud project that owns the backup infrastructure."
  type        = string
}

variable "environment" {
  description = "Deployment environment included in resource names."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "github_repository" {
  description = "GitHub repository allowed to use the backup service account (owner/name)."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository must use owner/name format."
  }
}

variable "github_refs" {
  description = "Finite allowlist of Git refs that can exchange an OIDC token."
  type        = set(string)
  default     = ["refs/heads/main"]

  validation {
    condition = (
      length(var.github_refs) > 0 &&
      alltrue([for ref in var.github_refs : can(regex("^refs/(heads|tags)/[A-Za-z0-9._/-]+$", ref))])
    )
    error_message = "github_refs must contain one or more full, safe heads or tags refs."
  }
}

variable "bucket_name_prefix" {
  description = "Bucket prefix. Environment and a stable project hash are appended for global uniqueness."
  type        = string
  default     = "care-record"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,30}[a-z0-9]$", var.bucket_name_prefix))
    error_message = "bucket_name_prefix must be 3-32 lowercase GCS-safe characters."
  }
}

variable "primary_region" {
  description = "Tokyo backup region."
  type        = string
  default     = "asia-northeast1"
}

variable "replica_region" {
  description = "Osaka replica region."
  type        = string
  default     = "asia-northeast2"
}

variable "backup_retention_days" {
  description = "Minimum retention for full backup objects."
  type        = number
  default     = 2555

  validation {
    condition     = var.backup_retention_days >= 2555
    error_message = "backup_retention_days cannot be shorter than seven years (2555 days)."
  }
}

variable "audit_retention_days" {
  description = "Minimum retention for immutable audit objects."
  type        = number
  default     = 3653

  validation {
    condition     = var.audit_retention_days >= 3653
    error_message = "audit_retention_days cannot be shorter than ten years (3653 days)."
  }
}

variable "enable_bucket_lock" {
  description = "IRREVERSIBLE: permanently lock backup and audit retention policies. Review a saved plan before setting true."
  type        = bool
  default     = false
}

variable "replication_start_date" {
  description = "First UTC date for the daily Tokyo-to-Osaka Storage Transfer job."
  type = object({
    year  = number
    month = number
    day   = number
  })
  default = {
    year  = 2026
    month = 1
    day   = 1
  }
}
