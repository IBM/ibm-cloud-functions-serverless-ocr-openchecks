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

  echo "(Added) log in to IBM cloud"
  ibmcloud login
  ibmcloud target -g Default

  echo "Binding Cloudant package"
    
  # ibmcloud fn package bind /whisk.system/cloudant "$CLOUDANT_INSTANCE" \
  #   --param username "$CLOUDANT_USERNAME" \
  #   --param password "$CLOUDANT_PASSWORD" \
  #   --param host "$CLOUDANT_HOST"
  

  ibmcloud fn package bind /whisk.system/cloudant "$CLOUDANT_INSTANCE"
  
  ibmcloud fn service bind cloudantnosqldb "$CLOUDANT_INSTANCE" \
    --instance "$CLOUDANT_INSTANCE" \
    --keyname cloudant-openchecks

  echo "Zipping actions"

  cd actions/find-new-checks
  zip -r -q find-new-checks.zip *
  cd ../..

  cd actions/save-check-images
  zip -r -q save-check-images.zip *
  cd ../..

  cd actions/parse-check-data
  zip -r -q parse-check-data.zip *
  cd ../..

  cd actions/record-check-deposit
  zip -r -q record-check-deposit.zip record-check-deposit *
  cd ../..

  echo "Creating alarm and Cloudant data change triggers"
  # The trigger will only fire for 30 minutes instead of 10k times.
  ibmcloud fn trigger create poll-for-incoming-checks \
    --feed /whisk.system/alarms/alarm \
    --param cron "$POLL_CHECKS_CRON" \
    --param maxTriggers $POLL_CHECKS_TIMES
  ibmcloud fn trigger create check-ready-to-scan \
    --feed "$CLOUDANT_INSTANCE/changes" \
    --param dbname "$CLOUDANT_AUDITED_DATABASE"
  ibmcloud fn trigger create check-ready-for-deposit \
    --feed "$CLOUDANT_INSTANCE/changes" \
    --param dbname "$CLOUDANT_PARSED_DATABASE"

  echo "Creating a package (here used as a namespace for shared environment variables)"
  ibmcloud fn package create openchecks \
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
  --param SENDGRID_FROM_ADDRESS "$SENDGRID_FROM_ADDRESS" \
  --param OW_HOST "$OW_HOST" \
  --param OW_API_KEY "$OW_API_KEY" \
  --param OW_NAMESPACE "$OW_NAMESPACE" \
  --param CFXN_API_KEY "$CFXN_API_KEY"

  echo "Creating actions"
  ibmcloud fn action create openchecks/find-new-checks actions/find-new-checks/find-new-checks.js --kind nodejs:16
  ibmcloud fn action create openchecks/save-check-images actions/save-check-images/save-check-images.zip --kind nodejs:16
  ibmcloud fn action create openchecks/parse-check-data actions/parse-check-data/parse-check-data.zip --kind nodejs:16
  ibmcloud fn action create openchecks/record-check-deposit actions/record-check-deposit/record-check-deposit.zip --kind nodejs:16

  # The new approach for processing Cloudant database triggers.
  ibmcloud fn action create openchecks/scan-sequence \
    --sequence $CLOUDANT_INSTANCE/read,openchecks/parse-check-data
  ibmcloud fn action create openchecks/deposit-sequence \
    --sequence $CLOUDANT_INSTANCE/read,openchecks/record-check-deposit

  # Build the Docker action. It's stored in the public Docker Hub.
  docker login --username "$DOCKER_HUB_USERNAME" --password "$DOCKER_HUB_PASSWORD"
  sh -c "cd dockerSkeleton && ./buildAndPush.sh $DOCKER_HUB_USERNAME/ocr-micr"
  ibmcloud fn action create openchecks/parse-check-with-ocr --docker $DOCKER_HUB_USERNAME/ocr-micr

  echo "Enabling rules"
  ibmcloud fn rule create fetch-checks poll-for-incoming-checks openchecks/find-new-checks
  ibmcloud fn rule create scan-checks check-ready-to-scan openchecks/scan-sequence
  ibmcloud fn rule create deposit-checks check-ready-for-deposit openchecks/deposit-sequence

  echo -e "${GREEN}Install Complete${NC}"
}

function uninstall() {
  echo -e "${RED}Uninstalling..."

  echo "Removing zipped files..."
  rm -rf actions/find-new-checks/find-new-checks.zip
  rm -rf actions/save-check-images/save-check-images.zip
  rm -rf actions/record-check-deposit/record-check-deposit.zip
  rm -rf actions/parse-check-data/parse-check-data.zip

  echo "Removing rules..."
  ibmcloud fn rule disable fetch-checks
  ibmcloud fn rule disable scan-checks
  ibmcloud fn rule disable deposit-checks
  sleep 1
  ibmcloud fn rule delete fetch-checks
  ibmcloud fn rule delete scan-checks
  ibmcloud fn rule delete deposit-checks

  echo "Removing triggers..."
  ibmcloud fn trigger delete poll-for-incoming-checks
  ibmcloud fn trigger delete check-ready-to-scan
  ibmcloud fn trigger delete check-ready-for-deposit

  echo "Removing actions..."
  ibmcloud fn action delete openchecks/find-new-checks
  ibmcloud fn action delete openchecks/save-check-images
  ibmcloud fn action delete openchecks/parse-check-data
  ibmcloud fn action delete openchecks/record-check-deposit
  ibmcloud fn action delete openchecks/parse-check-with-ocr
  ibmcloud fn action delete openchecks/scan-sequence
  ibmcloud fn action delete openchecks/deposit-sequence

  echo "Removing packages..."
  ibmcloud fn package delete "$CLOUDANT_INSTANCE"
  ibmcloud fn package delete openchecks

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
