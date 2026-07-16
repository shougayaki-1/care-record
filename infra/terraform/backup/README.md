# Backup infrastructure

This module provisions separate Tokyo (`asia-northeast1`) and Osaka
(`asia-northeast2`) backup buckets, a ten-year audit WORM bucket, daily Storage
Transfer replication, and GitHub Actions OIDC authentication. No service-account
key is created.

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
   file and replace all placeholders. Staging may temporarily allow the release
   branch in `github_refs`; Production must allow only `refs/heads/main`.
4. Run `terraform validate` and save a plan with
   `terraform plan -out=backup.tfplan`.
5. Put the `workload_identity_provider`, `backup_service_account`, and
   `backup_bucket` outputs in the matching GitHub Environment variables.
6. Keep `enable_bucket_lock = false` until the retention settings and saved plan
   have received separate approval. Setting it to `true` is irreversible in GCS.

The transfer job copies new immutable objects daily and never propagates deletes.
The 26-hour replica freshness alert should therefore compare the newest object in
both buckets rather than expecting deletions to converge.
