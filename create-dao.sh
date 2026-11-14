#!/usr/bin/env bash
# Usage: ./create-dao.sh <dao-name> <council1.testnet> [council2.testnet ...]
# Creates a Sputnik DAO on testnet (needs 6 NEAR). Result: <dao-name>.sputnikv2.testnet
set -euo pipefail
NAME=$1; shift
COUNCIL=$(printf '"%s",' "$@"); COUNCIL=${COUNCIL%,}
ARGS=$(echo -n "{\"config\":{\"name\":\"$NAME\",\"purpose\":\"Hot Potato community treasury\",\"metadata\":\"\"},\"policy\":[$COUNCIL]}" | base64 -w0)
near contract call-function as-transaction sputnikv2.testnet create \
  json-args "{\"name\":\"$NAME\",\"args\":\"$ARGS\"}" \
  prepaid-gas '150.0 Tgas' attached-deposit '6 NEAR' \
  sign-as "$1" network-config testnet sign-with-keychain send
echo "DAO account: $NAME.sputnikv2.testnet"
