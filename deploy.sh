#!/bin/bash
#
# Copyright 2016-2017 IBM Corp. All Rights Reserved.
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

function usage() {
  echo -e "${YELLOW}Usage: $0 [--install,--uninstall,--env]${NC}"
}

function install() {
  # Exit if any command fails
  set -e

  echo -e "${YELLOW}Installing Apache OpenWhisk actions, triggers, and rules on IBM Cloud Functions..."

  echo "Binding Cloudant package"
  wsk package bind /whisk.system/cloudant "$CLOUDANT_INSTANCE" \
    --param username "$CLOUDANT_USERNAME" \
    --param password "$CLOUDANT_PASSWORD" \
    --param host "$CLOUDANT_HOST"

  echo "Creating alarm and Cloudant data change triggers"
  # The trigger will only fire for 30 minutes instead of 10k times.
  wsk trigger create poll-for-incoming-checks \
    --feed /whisk.system/alarms/alarm \
    --param cron "$POLL_CHECKS_CRON" \
    --param maxTriggers $POLL_CHECKS_TIMES
  wsk trigger create check-ready-to-scan \
    --feed "/_/$CLOUDANT_INSTANCE/changes" \
    --param dbname "$CLOUDANT_AUDITED_DATABASE"
  wsk trigger create check-ready-for-deposit \
    --feed "/_/$CLOUDANT_INSTANCE/changes" \
    --param dbname "$CLOUDANT_PARSED_DATABASE"

  echo "Creating a package (here used as a namespace for shared environment variables)"
  wsk package create openchecks \
  --param CLOUDANT_USERNAME "$CLOUDANT_USERNAME" \
  --param CLOUDANT_PASSWORD "$CLOUDANT_PASSWORD" \
  --param CLOUDANT_HOST "$CLOUDANT_HOST" \
  --param CLOUDANT_ARCHIVED_DATABASE "$CLOUDANT_ARCHIVED_DATABASE" \
  --param CLOUDANT_AUDITED_DATABASE "$CLOUDANT_AUDITED_DATABASE" \
  --param CLOUDANT_PARSED_DATABASE "$CLOUDANT_PARSED_DATABASE" \
  --param CLOUDANT_REJECTED_DATABASE "$CLOUDANT_REJECTED_DATABASE" \
  --param CLOUDANT_PROCESSED_DATABASE "$CLOUDANT_PROCESSED_DATABASE" \
  --param OBJECT_STORAGE_API_KEY "$OBJECT_STORAGE_API_KEY" \
  --param OBJECT_STORAGE_CRN "$OBJECT_STORAGE_CRN" \
  --param OBJECT_STORAGE_REGION_NAME "$OBJECT_STORAGE_REGION_NAME" \
  --param OBJECT_STORAGE_INCOMING_CONTAINER_NAME "$OBJECT_STORAGE_INCOMING_CONTAINER_NAME" \
  --param SENDGRID_API_KEY "$SENDGRID_API_KEY" \
  --param SENDGRID_FROM_ADDRESS "$SENDGRID_FROM_ADDRESS"

  echo "Creating actions"
  wsk action create openchecks/find-new-checks actions/find-new-checks.js
  wsk action create openchecks/save-check-images actions/save-check-images.js
  wsk action create openchecks/parse-check-data actions/parse-check-data.js
  wsk action create openchecks/record-check-deposit actions/record-check-deposit.js

  # The new approach for processing Cloudant database triggers.
  wsk action create openchecks/scan-sequence \
    --sequence /_/$CLOUDANT_INSTANCE/read,openchecks/parse-check-data
  wsk action create openchecks/deposit-sequence \
    --sequence /_/$CLOUDANT_INSTANCE/read,openchecks/record-check-deposit

  # Build the Docker action. It's stored in the public Docker Hub.
  docker login --username "$DOCKER_HUB_USERNAME" --password "$DOCKER_HUB_PASSWORD"
  sh -c "cd dockerSkeleton && ./buildAndPush.sh $DOCKER_HUB_USERNAME/ocr-micr"
  wsk action create openchecks/parse-check-with-ocr --docker $DOCKER_HUB_USERNAME/ocr-micr

  echo "Enabling rules"
  wsk rule create fetch-checks poll-for-incoming-checks openchecks/find-new-checks
  wsk rule create scan-checks check-ready-to-scan openchecks/scan-sequence
  wsk rule create deposit-checks check-ready-for-deposit openchecks/deposit-sequence

  echo -e "${GREEN}Install Complete${NC}"
}

function uninstall() {
  echo -e "${RED}Uninstalling..."

  echo "Removing rules..."
  wsk rule disable fetch-checks
  wsk rule disable scan-checks
  wsk rule disable deposit-checks
  sleep 1
  wsk rule delete fetch-checks
  wsk rule delete scan-checks
  wsk rule delete deposit-checks

  echo "Removing triggers..."
  wsk trigger delete poll-for-incoming-checks
  wsk trigger delete check-ready-to-scan
  wsk trigger delete check-ready-for-deposit

  echo "Removing actions..."
  wsk action delete openchecks/find-new-checks
  wsk action delete openchecks/save-check-images
  wsk action delete openchecks/parse-check-data
  wsk action delete openchecks/record-check-deposit
  wsk action delete openchecks/parse-check-with-ocr
  wsk action delete openchecks/scan-sequence
  wsk action delete openchecks/deposit-sequence

  echo "Removing packages..."
  wsk package delete "$CLOUDANT_INSTANCE"
  wsk package delete openchecks

  echo -e "${GREEN}Uninstall Complete${NC}"
}

function showenv() {
  echo -e "${YELLOW}"
  echo OBJECT_STORAGE_API_KEY=$OBJECT_STORAGE_API_KEY
  echo OBJECT_STORAGE_CRN=$OBJECT_STORAGE_CRN
  echo OBJECT_STORAGE_REGION_NAME=$OBJECT_STORAGE_REGION_NAME
  echo OBJECT_STORAGE_INCOMING_CONTAINER_NAME=$OBJECT_STORAGE_INCOMING_CONTAINER_NAME
  echo CLOUDANT_INSTANCE=$CLOUDANT_INSTANCE
  echo CLOUDANT_USERNAME=$CLOUDANT_USERNAME
  echo CLOUDANT_PASSWORD=$CLOUDANT_PASSWORD
  echo CLOUDANT_HOST=$CLOUDANT_HOST
  echo CLOUDANT_ARCHIVED_DATABASE=$CLOUDANT_ARCHIVED_DATABASE
  echo CLOUDANT_AUDITED_DATABASE=$CLOUDANT_AUDITED_DATABASE
  echo CLOUDANT_PARSED_DATABASE=$CLOUDANT_PARSED_DATABASE
  echo CLOUDANT_PROCESSED_DATABASE=$CLOUDANT_PROCESSED_DATABASE
  echo CLOUDANT_REJECTED_DATABASE=$CLOUDANT_REJECTED_DATABASE
  echo SENDGRID_API_KEY=$SENDGRID_API_KEY
  echo SENDGRID_FROM_ADDRESS=$SENDGRID_FROM_ADDRESS
  echo DOCKER_HUB_USERNAME=$DOCKER_HUB_USERNAME
  echo DOCKER_HUB_PASSWORD=$DOCKER_HUB_PASSWORD
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
