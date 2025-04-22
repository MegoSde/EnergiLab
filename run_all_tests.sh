#!/bin/bash

SCRIPT_A="./run_c_collatz_test.sh"
SCRIPT_B="./run_python_collatz_test.sh"

# ABBA mønster gentaget 7½ gange = 15 af hver
PATTERN=(A B B A A B B A A B B A A B B A A B B A A B B A A B B A A B)

echo "===> Starter testsekvens: 15 x A og 15 x B"

for step in "${PATTERN[@]}"; do
  if [ "$step" == "A" ]; then
    echo "→ Kører A: C-collatz"
    $SCRIPT_A
  else
    echo "→ Kører B: Python-collatz"
    $SCRIPT_B
  fi
done

echo "✅ Alle 30 tests er færdige"

