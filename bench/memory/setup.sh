#!/bin/bash
# One-time setup of the memory measurement rig (see README.md).
set -euo pipefail
S=$(cd "$(dirname "$0")" && pwd)
C=$S/work/certs
mkdir -p "$C"
cd "$C"
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 365 -subj "/CN=rig-ca" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=localhost" 2>/dev/null
printf "subjectAltName=DNS:localhost,DNS:eu.hamedata.com,IP:127.0.0.1\n" > ext.cnf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 365 -extfile ext.cnf 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout client.key -out client.csr -subj "/CN=client" 2>/dev/null
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out client.crt -days 365 2>/dev/null
echo "mqtts://localhost:8883" > hame-2024-url
echo "mqtts://localhost:8884" > hame-2025-url
openssl rand -hex 16 > hame-2025-topic-encryption-key
cd "$S"
npm install --no-audit --no-fund
if ! grep -q "eu.hamedata.com" /etc/hosts; then
  echo "127.0.0.1 eu.hamedata.com" >> /etc/hosts
fi
echo "Rig ready."
