#!/bin/bash

echo $1 > params.json

# Cloudant credentials and the _id of the attachment/document to download.
CLOUDANT_USERNAME=`cat params.json | jq -r '.CLOUDANT_USERNAME'`
CLOUDANT_PASSWORD=`cat params.json | jq -r '.CLOUDANT_PASSWORD'`
CLOUDANT_AUDITED_DATABASE=`cat params.json | jq -r '.CLOUDANT_AUDITED_DATABASE'`
IMAGE_ID=`cat params.json | jq -r '.IMAGE_ID'`

# Download the image from Cloudant.
curl -s -X GET -o imgData \
"https://$CLOUDANT_USERNAME:$CLOUDANT_PASSWORD@$CLOUDANT_USERNAME.cloudant.com/$CLOUDANT_AUDITED_DATABASE/$IMAGE_ID/$IMAGE_ID?attachments=true&include_docs=true"

# Extract the account number and routing number as text by parsing for MICR font values.
tesseract imgData imgData.txt -l mcr2 >/dev/null 2>&1

# This matcher works with two of the checks we're using as samples for the PoC.
declare -a values=($(grep -Eo "\[[[0-9]+" imgData.txt.txt | sed -e 's/\[//g'))

# Extract the two values.
ROUTING=${values[0]}
ACCOUNT=${values[1]}

# Return JSON formatted values.
echo '{ "result": {"routing": "'$ROUTING'", "account": "'$ACCOUNT'"} }'
