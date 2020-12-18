#!/bin/bash
SCRIPTPATH="$( cd "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"
/bin/bash -c "SCRIPTPATH=$SCRIPTPATH $(curl -fsSL https://raw.githubusercontent.com/idexio/staking-replicator/main/scripts/start.sh)"