#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
aws cloudformation validate-template \
  --template-body "file://$repo_root/template.yml" \
  --profile "${DEPLOY_AWS_PROFILE:-mis}" \
  --region "${DEPLOY_AWS_REGION:-ap-south-1}"
