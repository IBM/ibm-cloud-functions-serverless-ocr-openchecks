#!/bin/bash
#
# Copyright 2016 IBM Corp. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the “License”);
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#  https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an “AS IS” BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Color vars to be used in shell script output
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
NC='\033[0m'

# Load configuration variables
source local.env

# Capture the namespace where actions will be created
WSK='wsk'
CURRENT_NAMESPACE=`$WSK property get --namespace | sed -n -e 's/^whisk namespace//p' | tr -d '\t '`
echo "Current namespace is $CURRENT_NAMESPACE."

function usage() {
  echo -e "${YELLOW}Usage: $0 [--install,--uninstall,--env]${NC}"
}

function install() {
  echo -e "${YELLOW}Installing OpenWhisk actions, triggers, and rules for check-deposit..."

  echo "Binding package"
  $WSK package bind /whisk.system/cloudant "$CLOUDANT_INSTANCE" \
    --param username "$CLOUDANT_USER" \
    --param password "$CLOUDANT_PASS" \
    --param host "$CLOUDANT_USER.cloudant.com"

  echo "Creating triggers"
  # The trigger will only fire for 30 minutes instead of 10k times.
  $WSK trigger create poll-for-incoming-checks \
    --feed /whisk.system/alarms/alarm \
    --param cron '*/20 * * * * *' \
    --param maxTriggers 90
  $WSK trigger create check-ready-to-scan \
    --feed "/$CURRENT_NAMESPACE/$CLOUDANT_INSTANCE/changes" \
    --param dbname "$CLOUDANT_AUDITED_DATABASE"
  $WSK trigger create check-ready-for-deposit \
    --feed "/$CURRENT_NAMESPACE/$CLOUDANT_INSTANCE/changes" \
    --param dbname "$CLOUDANT_PARSED_DATABASE"

  echo "Creating actions"
  $WSK action create find-new-checks actions/find-new-checks.js \
    --param CLOUDANT_USER "$CLOUDANT_USER" \
    --param CLOUDANT_PASS "$CLOUDANT_PASS" \
    --param SWIFT_USER_ID "$SWIFT_USER_ID" \
    --param SWIFT_PASSWORD "$SWIFT_PASSWORD" \
    --param SWIFT_PROJECT_ID "$SWIFT_PROJECT_ID" \
    --param SWIFT_REGION_NAME "$SWIFT_REGION_NAME" \
    --param SWIFT_INCOMING_CONTAINER_NAME "$SWIFT_INCOMING_CONTAINER_NAME" \
    --param CURRENT_NAMESPACE "$CURRENT_NAMESPACE"
  $WSK action create save-check-images actions/save-check-images.js \
    --param CLOUDANT_USER "$CLOUDANT_USER" \
    --param CLOUDANT_PASS "$CLOUDANT_PASS" \
    --param CLOUDANT_ARCHIVED_DATABASE "$CLOUDANT_ARCHIVED_DATABASE" \
    --param CLOUDANT_AUDITED_DATABASE "$CLOUDANT_AUDITED_DATABASE" \
    --param SWIFT_USER_ID "$SWIFT_USER_ID" \
    --param SWIFT_PASSWORD "$SWIFT_PASSWORD" \
    --param SWIFT_PROJECT_ID "$SWIFT_PROJECT_ID" \
    --param SWIFT_REGION_NAME "$SWIFT_REGION_NAME" \
    --param SWIFT_INCOMING_CONTAINER_NAME "$SWIFT_INCOMING_CONTAINER_NAME"
  $WSK action create parse-check-data actions/parse-check-data.js \
    --param CLOUDANT_USER "$CLOUDANT_USER" \
    --param CLOUDANT_PASS "$CLOUDANT_PASS" \
    --param CLOUDANT_AUDITED_DATABASE "$CLOUDANT_AUDITED_DATABASE" \
    --param CLOUDANT_PARSED_DATABASE "$CLOUDANT_PARSED_DATABASE" \
    --param CURRENT_NAMESPACE "$CURRENT_NAMESPACE"
  $WSK action create record-check-deposit actions/record-check-deposit.js \
    --param CLOUDANT_USER "$CLOUDANT_USER" \
    --param CLOUDANT_PASS "$CLOUDANT_PASS" \
    --param CLOUDANT_PARSED_DATABASE "$CLOUDANT_PARSED_DATABASE" \
    --param CLOUDANT_PROCESSED_DATABASE "$CLOUDANT_PROCESSED_DATABASE" \
    --param SENDGRID_API_KEY "$SENDGRID_API_KEY" \
    --param SENDGRID_FROM_ADDRESS "$SENDGRID_FROM_ADDRESS"

  # The new approach for processing Cloudant database triggers.
  $WSK action create scan-sequence \
    --sequence /$CURRENT_NAMESPACE/$CLOUDANT_INSTANCE/read,parse-check-data
  $WSK action create deposit-sequence \
    --sequence /$CURRENT_NAMESPACE/$CLOUDANT_INSTANCE/read,record-check-deposit

  # Build the Docker action. It's stored in the public Docker Hub.
  docker login --username "$DOCKER_USERNAME" --password "$DOCKER_PASSWORD"
  sh -c "cd dockerSkeleton && ./buildAndPush.sh $DOCKER_USERNAME/ocr-micr"
  $WSK action create --docker parse-check-with-ocr $DOCKER_USERNAME/ocr-micr

  echo "Enabling rules"
  $WSK rule create fetch-checks poll-for-incoming-checks find-new-checks
  $WSK rule create scan-checks check-ready-to-scan scan-sequence
  $WSK rule create deposit-checks check-ready-for-deposit deposit-sequence

  echo -e "${GREEN}Install Complete${NC}"
}

function uninstall() {
  echo -e "${RED}Uninstalling..."

  echo "Removing rules..."
  $WSK rule disable fetch-checks
  $WSK rule disable scan-checks
  $WSK rule disable deposit-checks
  sleep 1
  $WSK rule delete fetch-checks
  $WSK rule delete scan-checks
  $WSK rule delete deposit-checks

  echo "Removing triggers..."
  $WSK trigger delete poll-for-incoming-checks
  $WSK trigger delete check-ready-to-scan
  $WSK trigger delete check-ready-for-deposit

  echo "Removing actions..."
  $WSK action delete find-new-checks
  $WSK action delete save-check-images
  $WSK action delete parse-check-data
  $WSK action delete record-check-deposit
  $WSK action delete parse-check-with-ocr
  $WSK action delete scan-sequence
  $WSK action delete deposit-sequence

  echo "Removing packages..."
  $WSK package delete "$CLOUDANT_INSTANCE"

  echo -e "${GREEN}Uninstall Complete${NC}"
}

function showenv() {
  echo -e "${YELLOW}"
  echo SWIFT_USER_ID=$SWIFT_USER_ID
  echo SWIFT_PASSWORD=$SWIFT_PASSWORD
  echo SWIFT_PROJECT_ID=$SWIFT_PROJECT_ID
  echo SWIFT_REGION_NAME=$SWIFT_REGION_NAME
  echo SWIFT_INCOMING_CONTAINER_NAME=$SWIFT_INCOMING_CONTAINER_NAME
  echo CLOUDANT_INSTANCE=$CLOUDANT_INSTANCE
  echo CLOUDANT_USER=$CLOUDANT_USER
  echo CLOUDANT_PASS=$CLOUDANT_PASS
  echo CLOUDANT_ARCHIVED_DATABASE=$CLOUDANT_ARCHIVED_DATABASE
  echo CLOUDANT_AUDITED_DATABASE=$CLOUDANT_AUDITED_DATABASE
  echo CLOUDANT_PARSED_DATABASE=$CLOUDANT_PARSED_DATABASE
  echo CLOUDANT_PROCESSED_DATABASE=$CLOUDANT_PROCESSED_DATABASE
  echo SENDGRID_API_KEY=$SENDGRID_API_KEY
  echo SENDGRID_FROM_ADDRESS=$SENDGRID_FROM_ADDRESS
  echo DOCKER_USERNAME=$DOCKER_USERNAME
  echo DOCKER_PASSWORD=$DOCKER_PASSWORD
  echo -e "${NC}"
}

case "$1" in
"--install" )
install
;;
"--uninstall" )
uninstall
;;
"--env" )
showenv
;;
* )
usage
;;
esac
