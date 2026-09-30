#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
phase="${1:-}"
profile="${DEPLOY_AWS_PROFILE:-mis}"
region="${DEPLOY_AWS_REGION:-ap-south-1}"
stack="${DEPLOY_STACK_NAME:-karunodaya-mis-v2}"

if [[ "$phase" != bootstrap && "$phase" != publish ]]; then
  echo 'Usage: ./scripts/deploy.sh bootstrap|publish' >&2
  exit 2
fi
for executable in aws docker jq npm; do
  command -v "$executable" >/dev/null || { echo "Missing $executable" >&2; exit 1; }
done
for variable in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET_ARN COGNITO_DOMAIN_PREFIX; do
  if [[ -z "${!variable:-}" ]]; then echo "Set $variable before deployment." >&2; exit 1; fi
done

account="$(aws sts get-caller-identity --profile "$profile" --region "$region" --query Account --output text)"
expected_account="${DEPLOY_EXPECTED_ACCOUNT:-376015725430}"
if [[ "$account" != "$expected_account" ]]; then
  echo "Profile $profile resolves to account $account, expected $expected_account." >&2
  exit 1
fi
prefix_list="$(aws ec2 describe-managed-prefix-lists --profile "$profile" --region "$region" --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --query 'PrefixLists[0].PrefixListId' --output text)"
if [[ -z "$prefix_list" || "$prefix_list" == None ]]; then echo 'CloudFront origin-facing prefix list not found.' >&2; exit 1; fi

parameters=(
  "EnvironmentName=${DEPLOY_ENVIRONMENT:-prod}"
  "CognitoDomainPrefix=$COGNITO_DOMAIN_PREFIX"
  "GoogleClientId=$GOOGLE_CLIENT_ID"
  "GoogleClientSecretArn=$GOOGLE_CLIENT_SECRET_ARN"
  "CloudFrontPrefixListId=$prefix_list"
  "LocalCallbackUrl=${DEPLOY_LOCAL_CALLBACK_URL:-http://localhost:5173/}"
  "FrontendDomainName=${FRONTEND_DOMAIN:-}"
  "FrontendCertificateArn=${FRONTEND_CERTIFICATE_ARN:-}"
)

if [[ "$phase" == bootstrap ]]; then
  aws cloudformation deploy --template-file "$repo_root/template.yml" --stack-name "$stack" --profile "$profile" --region "$region" --capabilities CAPABILITY_IAM --parameter-overrides "${parameters[@]}" 'ApiImageUri='
else
  stack_json="$(aws cloudformation describe-stacks --stack-name "$stack" --profile "$profile" --region "$region" --output json)"
  output_value() { jq -r --arg key "$1" '.Stacks[0].Outputs[] | select(.OutputKey == $key) | .OutputValue' <<< "$stack_json"; }
  repository="$(output_value ApiRepositoryUri)"
  bucket="$(output_value FrontendBucketName)"
  distribution="$(output_value DistributionId)"
  user_pool="$(output_value UserPoolId)"
  client="$(output_value UserPoolClientId)"
  domain="$(output_value CognitoDomain)"
  app_url="$(output_value FrontendUrl)"
  for value in "$repository" "$bucket" "$distribution" "$user_pool" "$client" "$domain" "$app_url"; do
    if [[ -z "$value" || "$value" == null ]]; then echo 'Required stack output missing.' >&2; exit 1; fi
  done
  image_uri="$repository:${DEPLOY_IMAGE_TAG:-$(date -u +%Y%m%d%H%M%S)}"
  docker build --platform linux/amd64 -f "$repo_root/Dockerfile.api" -t "$image_uri" "$repo_root"
  aws ecr get-login-password --profile "$profile" --region "$region" | docker login --username AWS --password-stdin "${account}.dkr.ecr.${region}.amazonaws.com"
  docker push "$image_uri"
  aws cloudformation deploy --template-file "$repo_root/template.yml" --stack-name "$stack" --profile "$profile" --region "$region" --capabilities CAPABILITY_IAM --parameter-overrides "${parameters[@]}" "ApiImageUri=$image_uri"
  (cd "$repo_root" && VITE_COGNITO_USER_POOL_ID="$user_pool" VITE_COGNITO_CLIENT_ID="$client" VITE_COGNITO_DOMAIN="$domain" VITE_APP_URL="$app_url" npm run build:web)
  aws s3 sync "$repo_root/dist/" "s3://$bucket/" --delete --profile "$profile" --region "$region"
  aws cloudfront create-invalidation --distribution-id "$distribution" --paths '/*' --profile "$profile" --region "$region" >/dev/null
  echo "Frontend: $app_url"
  echo "API image: $image_uri"
fi

aws cloudformation describe-stacks --stack-name "$stack" --profile "$profile" --region "$region" --query 'Stacks[0].Outputs' --output table
