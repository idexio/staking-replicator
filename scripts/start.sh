#!/bin/bash

CONF_PATH="$SCRIPTPATH/idex-staking-replicator/conf/config.env"
if [[ -f $CONF_PATH ]]; then
    source $CONF_PATH
fi

mkdir -p "$SCRIPTPATH/idex-staking-replicator/conf"
mkdir -p "$SCRIPTPATH/idex-staking-replicator/logs"

echo "Starting IDEX Replicator..."

if [[ -z $API_KEY ]]; then
  read -p 'API Key: ' API_KEY
fi

API_KEY_PATTERN='^\{?[A-Z0-9a-z]{8}-[A-Z0-9a-z]{4}-[A-Z0-9a-z]{4}-[A-Z0-9a-z]{4}-[A-Z0-9a-z]{12}\}?$'
if [[ ! $API_KEY =~ $API_KEY_PATTERN ]]; then
  echo "Invalid API key, format is xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
  exit
fi

if [[ -z $IDEX_STAKING_SERVER_PORT ]]; then
  IDEX_STAKING_SERVER_PORT="8080"
fi

STOP_RESULT=`docker stop staking-replicator >/dev/null 2>&1`
RM_RESULT=`docker rm staking-replicator >/dev/null 2>&1`

RUN_RESULT=`docker run -i -t -d \
  --restart=always \
  --name staking-replicator \
  --publish $IDEX_STAKING_SERVER_PORT:$IDEX_STAKING_SERVER_PORT \
  --mount "type=bind,source=$SCRIPTPATH/idex-staking-replicator/conf,destination=/conf/" \
  --mount "type=bind,source=$SCRIPTPATH/idex-staking-replicator/logs,destination=/logs/" \
  --env API_KEY="$API_KEY" \
  --env IDEX_STAKING_ACCESS_LOG_PATH=/logs/access.log \
  --env IDEX_STAKING_ACTIVITY_LOG_PATH=/logs/activity.log \
  --env IDEX_STAKING_ERROR_LOG_PATH=/logs/errors.log \
  idexio/staking-replicator`

echo "IDEX Staking running as $RUN_RESULT"

WATCHTOWER_RUNNING="$(docker ps -aq --filter name=idex-watchtower)"

if [[ -z $WATCHTOWER_RUNNING ]]
then
  RESULT=`docker run -d \
    --rm \
    --name idex-watchtower \
    -v /var/run/docker.sock:/var/run/docker.sock \
    containrrr/watchtower \
    staking-replicator`
fi
echo "Watchtower running as $RESULT"
