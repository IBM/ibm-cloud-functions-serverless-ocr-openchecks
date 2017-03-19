#!/bin/bash

##############################################################################
# Copyright 2017 IBM Corporation
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
##############################################################################
set -e

OPENWHISK_BIN=/home/ubuntu/bin
LINK=https://openwhisk.ng.bluemix.net/cli/go/download/linux/amd64/wsk

echo "Downloading OpenWhisk CLI from '$LINK'...\n"
curl -O $LINK
chmod u+x wsk
export PATH=$PATH:`pwd`

echo "Configuring CLI from apihost and API key\n"
wsk property set --apihost openwhisk.ng.bluemix.net --auth $OPENWHISK_KEY > /dev/null 2>&1

echo "Configure local.env"
touch local.env # Configurations defined in travis-ci console

echo "installing jq for bash json parsing"
sudo apt-get install jq

echo "Cleanly deploying wsk actions, etc."
./deploy.sh --uninstall
./deploy.sh --install

echo "Waiting for triggers/actions to finish installing (sleep 5)"
sleep 5

echo "Invoking a write to Cloudant"
echo "TODO: test"

echo "Waiting for triggers/actions to finish executing(sleep 5)"
sleep 5

echo "Verify actions were triggered"
LAST_ACTIVATION=`wsk activation list | head -2 | tail -1 | awk '{ print $1 }'`
echo "TODO: test"

echo "Uninstalling wsk actions, etc."
./deploy.sh --uninstall
