terraform {
  required_version = ">= 1.7.0"

  # Bucket and prefix are supplied at init time for environment-separated state.
  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.primary_region
}
