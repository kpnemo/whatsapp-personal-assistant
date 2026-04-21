# AWS Lightsail Containers deploy template

Deploy WPA to [AWS Lightsail Containers](https://aws.amazon.com/lightsail/features/containers/) — AWS's simplest container hosting.

## Quick-Create CloudFormation link

Replace `<region>` (e.g. `us-east-1`) and `<template-url>` with the public URL of your CloudFormation stack template:

```
https://console.aws.amazon.com/cloudformation/home?region=<region>#/stacks/quickcreate?templateURL=<template-url>&stackName=wpa
```

If you maintain a fork, host a CloudFormation JSON/YAML alongside this directory and paste its raw URL into the link above.

## Manual deploy (CLI)

```bash
# 1. Create a container service
aws lightsail create-container-service \
  --service-name wpa \
  --power small \
  --scale 1

# 2. Deploy using this containers.json (edit <owner> first!)
aws lightsail create-container-service-deployment \
  --service-name wpa \
  --cli-input-json file://containers.json
```

Lightsail Containers pull directly from `ghcr.io/<owner>/whatsapp-personal-assistant:latest` — publish the image first via the repo's `release.yml` (push a `v*` tag).

## Companion AWS services

Lightsail Containers do not include a database. Provision alongside:

- **RDS Postgres** (`db.t4g.micro` minimum). Put in the same VPC and security group as the Lightsail VPC peering target; pass `DATABASE_URL` via `environment` in `containers.json`.
- **ElastiCache Redis** (`cache.t4g.micro`). Same VPC. Pass `REDIS_URL`.

Enable **Lightsail VPC peering** under Account → Networking so the container service can reach RDS/ElastiCache.

## Secrets via AWS Secrets Manager

`containers.json` does not commit plaintext secrets. Inject them at deploy time:

1. Create secrets: `aws secretsmanager create-secret --name wpa/master-key --secret-string "$(openssl rand -hex 32)"` (repeat for `jwt-secret`, `db-url`, `redis-url`).
2. Attach an IAM role to your Lightsail VPC instance with `secretsmanager:GetSecretValue` for `arn:aws:secretsmanager:*:*:secret:wpa/*`.
3. Fetch at deploy time and add to `containers.app.environment` before calling `create-container-service-deployment`:

   ```bash
   MASTER_KEY=$(aws secretsmanager get-secret-value --secret-id wpa/master-key --query SecretString --output text)
   jq --arg mk "$MASTER_KEY" '.containers.app.environment.MASTER_KEY = $mk' containers.json > out.json
   aws lightsail create-container-service-deployment --service-name wpa --cli-input-json file://out.json
   ```

Never commit `out.json` — it contains plaintext.

## Required env keys (final rendered containers.json)

| Key                 | Source                                                 |
| ------------------- | ------------------------------------------------------ |
| `NODE_ENV`          | `production`                                           |
| `ENTRYPOINT_ROLE`   | `all`                                                  |
| `MASTER_KEY`        | Secrets Manager `wpa/master-key`                       |
| `JWT_SECRET`        | Secrets Manager `wpa/jwt-secret`                       |
| `DATABASE_URL`      | RDS endpoint (Secrets Manager `wpa/db-url`)            |
| `REDIS_URL`         | ElastiCache endpoint (Secrets Manager `wpa/redis-url`) |
| `PUBLIC_APP_ORIGIN` | `https://wpa.<region>.cs.amazonlightsail.com`          |

## Notes

- The image must already be published. Tag a release (`git tag v0.1.0 && git push --tags`) to trigger `release.yml` and populate `ghcr.io`.
- Lightsail Containers use public HTTPS out of the box — no ALB needed.
- For split-process deployment, define three containers (`api`, `worker`, `agent`) each with its own `ENTRYPOINT_ROLE` and make only `api` the public endpoint.
