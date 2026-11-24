# Audit archive infrastructure (#150)

新しい環境別10年監査bucketと、writer/verifier/controlの別サービスアカウントを準備する独立state。
既存 `backup` state・7年bucket・object・IAM・lockを変更しない。
詳細は [運用手順](../../../docs/audit-archive-runbook.md)。

- `project_id` / `environment` を環境専用tfvarsに指定し、backend bucket/prefixも環境別にする。
- `workload_members` は承認済みWIF identityだけを渡す。空の既定値ではimpersonationを許可しない。
  GitHubの場合、環境とrepository/refを限定した既存WIF providerのprincipalを使う。
  writer/verifier/controlを同じsubjectで引き受けられるprincipalSetにしない。
- `enable_bucket_lock=false` が既定。不可逆なLockの適用はsaved planと影響を提示し、別途承認を得る。
- creatorはcreateのみ、readerはprefix条件付きget、listは監査専用bucketに限定。
  上書きに必要なdelete、bucket設定変更、他prefixへの作成は付与しない。
  inherited/project-level IAMを実確認し、別の広域grantでこの分離が迂回されないことを検証する。
- provider初期化・validateは環境を変更しない。plan/applyは実環境承認の対象。
  このPRでは実bucket作成・IAM変更・Bucket Lock・applyを実行しない。

```sh
terraform init -backend=false
terraform validate
```
