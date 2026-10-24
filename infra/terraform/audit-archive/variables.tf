variable "project_id" { type = string }
variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Use a separate staging or production state."
  }
}
variable "bucket_name_prefix" {
  type    = string
  default = "care-record"
}
variable "enable_bucket_lock" {
  type        = bool
  default     = false
  description = "Irreversible: true requires a separately approved saved plan."
}
variable "workload_members" {
  type        = map(string)
  default     = {}
  description = "Separately approved WIF principal/principalSet per writer, verifier and control. No long-lived keys are created."
  validation {
    condition     = alltrue([for role, member in var.workload_members : contains(["writer", "verifier", "control"], role) && startswith(member, "principal")]) && length(distinct(values(var.workload_members))) == length(var.workload_members)
    error_message = "Each workload must use a distinct WIF principal and a recognized audit role."
  }
}
