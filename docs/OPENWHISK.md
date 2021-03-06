# Set up OpenWhisk actions, triggers, and rules

If you haven't already, download, install, and test the [`wsk` CLI tool](https://new-console.ng.bluemix.net/openwhisk/cli).

From this point forward, you can instead just run the following commands to set up the OpenWhisk resources with a deployment script:

- Make sure `local.env` is complete. Run `./deploy.sh --env` to see if all necessary variables are set.
- Create the actions, trigger, rules, and package bindings with `./deploy.sh --install`
- If you run into any issues installing run `./deploy.sh --uninstall` to start with a fresh environment.

Otherwise, read on if you want to understand how all the OpenWhisk actions, triggers, and rules come together or if you want to set them up yourself.

## Make environment variables available

```bash
source local.env
```

## Create custom actions

- Create a package to use as a namespace for shared environment variables

  ```bash
  wsk package create openchecks \
  --param CLOUDANT_USERNAME "$CLOUDANT_USERNAME" \
  --param CLOUDANT_PASSWORD "$CLOUDANT_PASSWORD" \
  --param CLOUDANT_ARCHIVED_DATABASE "$CLOUDANT_ARCHIVED_DATABASE" \
  --param CLOUDANT_AUDITED_DATABASE "$CLOUDANT_AUDITED_DATABASE" \
  --param CLOUDANT_PARSED_DATABASE "$CLOUDANT_PARSED_DATABASE" \
  --param CLOUDANT_REJECTED_DATABASE "$CLOUDANT_REJECTED_DATABASE" \
  --param CLOUDANT_PROCESSED_DATABASE "$CLOUDANT_PROCESSED_DATABASE" \
  --param OBJECT_STORAGE_USER_ID "$OBJECT_STORAGE_USER_ID" \
  --param OBJECT_STORAGE_PASSWORD "$OBJECT_STORAGE_PASSWORD" \
  --param OBJECT_STORAGE_PROJECT_ID "$OBJECT_STORAGE_PROJECT_ID" \
  --param OBJECT_STORAGE_REGION_NAME "$OBJECT_STORAGE_REGION_NAME" \
  --param OBJECT_STORAGE_INCOMING_CONTAINER_NAME "$OBJECT_STORAGE_INCOMING_CONTAINER_NAME" \
  --param SENDGRID_API_KEY "$SENDGRID_API_KEY" \
  --param SENDGRID_FROM_ADDRESS "$SENDGRID_FROM_ADDRESS"
  ```

- Create the action to poll for new checks:

  ```bash
  wsk action create openchecks/find-new-checks actions/find-new-checks.js
  ```

- Create the action to save check images:

  ```bash
  wsk action create openchecks/save-check-images actions/save-check-images.js
  ```

- Create the action to parse check data:

  ```bash
  wsk action create openchecks/parse-check-data actions/parse-check-data.js
  ```

- Create the action to execute the optical character recognition:

  ```bash
  docker login --username "$DOCKER_HUB_USERNAME" --password "$DOCKER_HUB_PASSWORD"
  sh -c "cd dockerSkeleton && ./buildAndPush.sh $DOCKER_HUB_USERNAME/ocr-micr"
  wsk action create openchecks/parse-check-with-ocr --docker $DOCKER_HUB_USERNAME/ocr-micr
  ```

- Create the action to record the check deposit:

  ```bash
  wsk action create openchecks/record-check-deposit actions/record-check-deposit.js
  ```

## Create custom triggers and rules

- Bind the database

  ```bash
  wsk package bind /whisk.system/cloudant "$CLOUDANT_INSTANCE" \
    --param username "$CLOUDANT_USERNAME" \
    --param password "$CLOUDANT_PASSWORD" \
    --param host "$CLOUDANT_USERNAME.cloudant.com"
  ```

- Create the triggers for the Cloudant feeds:

  ```bash
  wsk package bind /whisk.system/cloudant "$CLOUDANT_INSTANCE" \
    --param username "$CLOUDANT_USERNAME" \
    --param password "$CLOUDANT_PASSWORD" \
    --param host "$CLOUDANT_USERNAME.cloudant.com"
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
  ```

- Create the sequences for handling the database changes:

  ```bash
  wsk action create openchecks/scan-sequence \
    --sequence /_/$CLOUDANT_INSTANCE/read,openchecks/parse-check-data
  wsk action create openchecks/deposit-sequence \
    --sequence /_/$CLOUDANT_INSTANCE/read,openchecks/record-check-deposit
  ```

- Create the rules linking the triggers to the actions:

  ```bash
  wsk rule create fetch-checks poll-for-incoming-checks openchecks/find-new-checks
  wsk rule create scan-checks check-ready-to-scan openchecks/scan-sequence
  wsk rule create deposit-checks check-ready-for-deposit openchecks/deposit-sequence
  ```

## Running the sample

At this point the triggers, rules, and actions are in place. The Object Storage polling trigger will run every 20 seconds for half an hour by default (90 invocations). You can change this by updating the `POLL_CHECKS_CRON` and `POLL_CHECKS_TIMES` variables.

Open another terminal to start tailing the OpenWhisk logs with `wsk activation poll` so you can see the progress when you start running the sample and are able to debug any issues.

To start the sample, rename the five check images to contain a valid email address that you have access to (replacing "user@example.com"). That is where the SendGrid notifications will be sent. Then use the Bluemix UI to add those images to your `openchecks` Object Storage container.

The `find-new-checks` action will download the images on its next poll (within 20 seconds as set by the alarm trigger) and this will start the sequence of actions.

If all has been successful, you will have 25% and 50% resized copies of the check images as attachments in your `CLOUDANT_ARCHIVED_DATABASE`. You will have the original image as an attachment in your `CLOUDANT_AUDITED_DATABASE`. You will have the OCR parsed from the check and its filename in the `CLOUDANT_PARSED_DATABASE` and you will have the final transaction info (simulating an external system of record) in the `CLOUDANT_PROCESSED_DATABASE`. Any checks that could not be parsed will be in the `CLOUDANT_REJECTED_DATABASE`.

## Known issues

- With the default free Cloudant account, this demo may hit the request per second rate. There may also be conflicts shown in the logs due to retries on image insertions. Confirm that the data in Cloudant is as you expect.
- Rather than polling Object Storage, the save image action should be driven by a [webhook from OpenStack Swift](https://github.com/stmuraka/OpenStackSwift-OpenWhisk). As this is not something that you can configure in Bluemix today, the polling option is used.

## Troubleshooting

Check for errors first in the OpenWhisk activation log. Tail the log on the command line with `wsk activation poll` or drill into details visually with the [monitoring console on Bluemix](https://console.ng.bluemix.net/openwhisk/dashboard).

If the error is not immediately obvious, make sure you have the [latest version of the `wsk` CLI installed](https://console.ng.bluemix.net/openwhisk/learn/cli). If it's older than a few weeks, download an update.

```bash
wsk property get --cliversion
```
