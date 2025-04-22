#!/bin/bash

# Konfiguration
CONTROLLER_URL="http://localhost:3000/api"
SUT_USER="sut-user"
SUT_HOST="192.168.0.174"
SUT_PASS="sut-pass"
REMOTE_CMD="/home/sut-user/collatz/c/collatz_count_112"

# Generer navn med timestamp
NOW=$(date +"%Y%m%d-%H%M%S")
SESSION_NAME="c-collatz-$NOW"

echo "===> Starter test: $SESSION_NAME"

# 1. Start session med state=idle
curl -s -X POST "$CONTROLLER_URL/start" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$SESSION_NAME\", \"state\": \"idle\"}"

# 2. Idle - vent 60 sek
echo "===> Idle: venter 60 sek"
sleep 60

# 3. Skift state til warmup
echo "===> Skifter til warmup"
curl -s -X POST "$CONTROLLER_URL/state" \
  -H "Content-Type: application/json" \
  -d '{"state": "warmup"}'

sleep 15
# 4. SSH: kør collatz_count_112 1000 (10 gange)
echo "===> Kører warmup på SUT"
sshpass -p "$SUT_PASS" ssh -o StrictHostKeyChecking=no $SUT_USER@$SUT_HOST "
  for i in {1..10}; do
    $REMOTE_CMD 1000 > /dev/null
  done
"

sleep 30

# 6. Skift til state work
echo "===> Skifter til work"
curl -s -X POST "$CONTROLLER_URL/state" \
  -H "Content-Type: application/json" \
  -d '{"state": "work"}'

# 7. SSH: kør collatz_count_112 1000000 (10 gange)
echo "===> Kører work på SUT"
sshpass -p "$SUT_PASS" ssh -o StrictHostKeyChecking=no $SUT_USER@$SUT_HOST "
  for i in {1..100}; do
    $REMOTE_CMD 1000000 > /dev/null
  done
"

sleep 15

# 8. Skift til state warmdown
echo "===> Skifter til warmdown"
curl -s -X POST "$CONTROLLER_URL/state" \
  -H "Content-Type: application/json" \
  -d '{"state": "warmdown"}'

# 9. Vent 75 sek
echo "===> Venter 75 sek (warmdown)"
sleep 75

# 10. Stop session
echo "===> Stopper session"
curl -s -X POST "$CONTROLLER_URL/stop"

echo "===> Test færdig: $SESSION_NAME"

