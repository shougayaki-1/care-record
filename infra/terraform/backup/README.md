# Backup infrastructure

This module provisions separate Tokyo (`asia-northeast1`) and Osaka
(`asia-northeast2`) backup buckets, a ten-year audit WORM bucket, daily Storage
Transfer replication, and GitHub Actions Workload Identity Federation. It does
not create a service-account key.

Keep the Terraform state and backup resources separate for `staging` and
`production`. The staging environment is a GitHub Environment used by the
backup workflows; it does not require a permanent `staging` Git branch.

1. Bootstrap one dedicated GCS state bucket per GCP project. Enable uniform
   bucket-level access, public-access prevention, and object versioning. Do not
   enable Bucket Lock on the state bucket.
2. Initialize the environment-specific remote state. For example:

   ```sh
   terraform init \
     -backend-config="bucket=care-record-tfstate-PROJECT_NUMBER" \
     -backend-config="prefix=backup/staging"
   ```

3. Copy `terraform.tfvars.example` to an untracked environment-specific tfvars
   file and replace all placeholders. `github_refs` is an exact allowlist of
   Git refs; this module currently accepts complete branch or tag refs and does
   not accept wildcard patterns. The scheduled backup workflow runs from
   `main`, and manual staging/Production runs select their GitHub Environment
   from a workflow input. Allow `refs/heads/main` for both environments when
   they are dispatched from `main`. If a pre-merge test needs another branch,
   allow that exact ref temporarily and remove it after the change is merged.
   Keep Production limited to `refs/heads/main`.
4. Run `terraform validate` and save a plan with
   `terraform plan -out=backup.tfplan`.
5. Put the `workload_identity_provider`, `backup_service_account`, and
   `backup_bucket` outputs in the matching GitHub Environment variables. The
   backup workflow reads these values from GitHub; it does not use application
   `.env.local` or Vercel runtime credentials.
6. Keep `enable_bucket_lock = false` until the retention settings and saved plan
   have received separate approval. Setting it to `true` is irreversible in
   GCS.

The transfer job copies new immutable objects daily and never propagates
deletes. The 26-hour replica freshness alert should compare the newest object in
both buckets rather than expecting deletions to converge.
