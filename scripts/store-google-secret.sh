#!/usr/bin/env bash
set +x
set -euo pipefail

profile="${DEPLOY_AWS_PROFILE:-mis}"
region="${DEPLOY_AWS_REGION:-ap-south-1}"
secret_name="${GOOGLE_SECRET_NAME:-karunodaya/mis/google-oauth}"
expected_account="${DEPLOY_EXPECTED_ACCOUNT:-376015725430}"

if [[ ! -r /dev/tty ]]; then
  echo 'Run this script in an interactive terminal so the secret can be entered privately.' >&2
  exit 1
fi
account="$(aws sts get-caller-identity --profile "$profile" --region "$region" --query Account --output text)"
if [[ "$account" != "$expected_account" ]]; then
  echo "Profile $profile points to account $account; expected $expected_account." >&2
  exit 1
fi

IFS= read -r -s -p 'Paste Google OAuth client secret (input hidden), then press Enter: ' google_secret < /dev/tty
printf '\n' >&2
if [[ -z "$google_secret" ]]; then
  echo 'The secret was empty; nothing was written.' >&2
  exit 1
fi
trap 'unset google_secret' EXIT

if aws secretsmanager describe-secret --profile "$profile" --region "$region" --secret-id "$secret_name" --query ARN --output text >/dev/null 2>&1; then
  arn="$(printf '%s' "$google_secret" | aws secretsmanager put-secret-value --profile "$profile" --region "$region" --secret-id "$secret_name" --secret-string file:///dev/stdin --query ARN --output text)"
else
  arn="$(printf '%s' "$google_secret" | aws secretsmanager create-secret --profile "$profile" --region "$region" --name "$secret_name" --description 'Google OAuth client secret for Karunodaya MIS Cognito federation' --secret-string file:///dev/stdin --query ARN --output text)"
fi

echo "Secret stored in AWS Secrets Manager. ARN: $arn"
