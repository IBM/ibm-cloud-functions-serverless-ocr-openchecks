# Setting up the environment

This document describes how to use Bluemix to set up the Cloudant database, Object Storage service, and SendGrid email service. You'll also need a [Docker Hub](https://hub.docker.com/) account.

After completing the steps here, proceed to [set up the OpenWhisk actions, triggers, and rules](OPENWHISK.md).

## Provision services and set environment variables

Start by copying `template.local.env` to a new `local.env` file. You can fill in additional details as you go through the steps below. The `.gitignore` file will prevent that private file from being pushed to source control if you push modifications to your own fork.

### Set up Cloudant

Log into the [Bluemix console](https://console.ng.bluemix.net/) and create a [Cloudant instance](https://console.ng.bluemix.net/catalog/services/cloudant-nosql-db/?taxonomyNavigation=services&env_id=ibm:yp:us-south) named `cloudant-openchecks`. You can reuse an existing instance if you already have one. Update `CLOUDANT_INSTANCE` in `local.env` to reflect the name of the Cloudant service instance if you name it something else.

Then set the `CLOUDANT_USERNAME` and `CLOUDANT_PASSWORD` values in `local.env` based on the service credentials for the service.

> **Note**: The Cloudant service credentials and connectivity details can be automatically bound to the OpenWhisk context with `wsk package refresh`, as they are in many [simpler use cases](https://github.com/IBM/openwhisk-cloudant-trigger). However, since we are writing more than a simple JSON object back to Cloudant, we will use the Cloudant NPM client directly with the credentials, rather than through the Cloudant packaged write action.

Log into the Cloudant console and create five databases. Set their names in the `CLOUDANT_ARCHIVED_DATABASE`, `CLOUDANT_AUDITED_DATABASE`, `CLOUDANT_PARSED_DATABASE`, `CLOUDANT_REJECTED_DATABASE`, and `CLOUDANT_PROCESSED_DATABASE` variables.

### Set up Object Storage

Log into the Bluemix console and create an [Object Storage instance](https://console.ng.bluemix.net/catalog/services/object-storage?env_id=ibm:yp:us-south&taxonomyNavigation=services) named `object-storage-openchecks`. Create a container within named `openchecks`. Create a new set of credentials for the service and update the `local.env` variables for `OBJECT_STORAGE_USER_ID`, `OBJECT_STORAGE_PASSWORD`, `OBJECT_STORAGE_PROJECT_ID`, and `OBJECT_STORAGE_REGION_NAME` accordingly.

### Set up SendGrid

Log into the Bluemix console and create a [SendGrid](https://console.ng.bluemix.net/catalog/services/sendgrid/?taxonomyNavigation=services) instance. If you don't want to pay for the minimum plan, you can go to [SendGrid directly to request a free trial](http://sendgrid.com/). Follow the developer documentation to configure an API key. Update `local.env` accordingly. There is important additional information on [configuring SendGrid with Bluemix here](https://www.ibm.com/blogs/bluemix/2016/12/using-sendgrid-easy-sending-email/) in case you run into any issues.

### Set up Docker Hub

Create a [Docker Hub](https://hub.docker.com/) account if you don't already have one. This account will be used to upload and tag your Docker action after it's built. OpenWhisk will then download your image by tag name. Update `local.env` with your `DOCKER_HUB_USERNAME` and `DOCKER_HUB_PASSWORD`.

## Next steps

After completing the steps here, proceed to [set up the OpenWhisk actions, triggers, and rules](OPENWHISK.md).
