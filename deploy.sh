#!/usr/bin/env bash
# Usage: ./deploy.sh <contract.testnet> <dao.sputnikv2.testnet> [round_window_secs, default 600]
set -euo pipefail
CONTRACT=$1; DAO=$2; WINDOW=${3:-600}
(cd contract && cargo near deploy build-non-reproducible-wasm --no-abi "$CONTRACT" \
  with-init-call new json-args "{\"treasury\":\"$DAO\",\"base_window_secs\":$WINDOW}" \
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-keychain send)
cp web/.env.example web/.env
sed -i "s/REPLACE_CONTRACT/$CONTRACT/g; s/REPLACE_DAO/$DAO/g" web/.env
echo "Deployed. Serve the UI:  cd web && npm install && npm run dev"