#!/bin/bash
# init
# =============================================
# SCRIPT COMMANDS
echo
echo "===============  BUILDING DOCKER IMAGE ==============="
PACKAGE_VERSION=$(node -p "require('../package.json').version")
SCRIPTPATH=$(dirname "$SCRIPT")
docker build "$SCRIPTPATH/.." -t idexio/staking-replicator:silverton -t idexio/staking-replicator:latest -t idexio/staking-replicator:$PACKAGE_VERSION