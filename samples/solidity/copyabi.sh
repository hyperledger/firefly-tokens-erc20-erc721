#!/bin/sh

set -euo pipefail

ABIS=$(ls artifacts/contracts/*/*.json | grep -v ".dbg.json")
cp ${ABIS} ../../src/abi
