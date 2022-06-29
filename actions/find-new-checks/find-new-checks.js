/**
 * Copyright 2016-2017 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var openwhisk = require('openwhisk');
var async = require('async');
var fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
var ibm = require('ibm-cos-sdk');
const { URLSearchParams } = require('url');


/**
 * This action is triggered by a new check image added to object storage, or in this case a CouchDB database.
 * This action is idempotent. If it fails, it can be retried.
 *
 * 1. Fetch the record from the 'incoming' object storage container.
 * 2. Process the image for account, routing number, and amount move it to another 'processed' database with metadata and a confidence score.
 *
 * @param   params.OBJECT_STORAGE_API_KEY                   Object storage api key
 * @param   params.OBJECT_STORAGE_CRN                  Object storage crn
 * @param   params.OBJECT_STORAGE_REGION_NAME               Object storage region
 * @param   params.OBJECT_STORAGE_INCOMING_CONTAINER_NAME   Object storage container where the image is
 * @return                                                  Standard OpenWhisk success/error response
 */

/*
const path = require('path')
require('dotenv').config({path: path.resolve(__dirname, '../../local.env')})
main(process.env);
*/


function main(params) {
  console.log("Retrieving file list");

  var os = new ObjectStorage(
    params.OBJECT_STORAGE_REGION_NAME, 
    params.OBJECT_STORAGE_API_KEY, 
    params.OBJECT_STORAGE_CRN
  );

  return new Promise((resolve, reject) => {
      getIAMToken(params.CFXN_API_KEY).then((access_token) => {
        os.listFiles(params.OBJECT_STORAGE_INCOMING_CONTAINER_NAME, function (err, files) {

        if (err || !files || !files['Contents']) {
          console.log(err);
          console.log("0 files found.");
          return;
        }

        console.log(files);
        console.log("Found", files["Contents"].length, "file(s)");
        tasks = files["Contents"].map(function(file) {
          return function(callback) {
            asyncCallSaveCheckImagesAction(
              "openchecks/save-check-images",
              file.Key,
              file.LastModified,
              params,
              access_token,
              callback
            );
          };
        });

        async.waterfall(tasks, function(err, result) {
          if (err) {
            console.log("Error", err);
            reject(err);
          } else {
            resolve({
              status: "Success"
            });
          }
        });
      });
    });
  });
}


/**
 * This function provides a way to invoke other OpenWhisk actions directly and asynchronously
 *
 * @param   actionName    The id of the record in the Cloudant 'processed' database
 * @param   fileName      Cloudant username (set once at action update time)
 * @param   contentType   Cloudant password (set once at action update time)
 * @param   lastModified  Cloudant password (set once at action update time)
 * @param   callback      Cloudant password (set once at action update time)
 * @return                The reference to a configured object storage instance
 */
function asyncCallSaveCheckImagesAction(actionName, fileName, lastModified, params, access_token, callback) {
  console.log("Calling", actionName, "for", fileName);

  const authHandler = {
    getAuthHeader: () => {
      return Promise.resolve('Bearer ' + access_token);
    }
  }

  var options = {
    apihost: params.OW_HOST,
    api_key: params.OW_API_KEY,
    auth_handler: authHandler,
    namespace: params.OW_NAMESPACE
  }

  var wsk = openwhisk(options);
  
  return new Promise(function(resolve, reject) {
    wsk.actions.invoke({
      "actionName": actionName,
      "params": {
        fileName: fileName,
        lastModified: lastModified
      },
    }).then(
      function(activation) {
        console.log(actionName, "[activation]", activation);
        resolve(activation);
      }
    ).catch(
      function(error) {
        console.log(actionName, "[error]", error);
        reject(error);
      }
    );
  });
}

function getIAMToken(apiKey) {
    var options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        "apikey": apiKey,
        "response_type": "cloud_iam",
        "grant_type": "urn:ibm:params:oauth:grant-type:apikey"
      })
    }

    const iamURL = "https://iam.cloud.ibm.com/identity/token";
    
    return new Promise((resolve, reject) => {
      fetch(iamURL, options).then(response => 
        response.json()
      ).then(data => {
        console.log("Authentication success");
        return resolve(data.access_token);
      }).catch(err => {
        reject(err)
      })
    })
}

function ObjectStorage(region, apiKey, osInstanceId) {
  var self = this;

  self.baseUrl = "https://s3." + region + ".cloud-object-storage.appdomain.cloud/"

  var config = {
    endpoint: self.baseUrl,
    apiKeyId: apiKey,
    serviceInstanceId: osInstanceId
  }
  
  self.cos = new ibm.S3(config);

  self.listFiles = function(bucket, callback) {
    self.cos.listObjectsV2({Bucket: bucket}, callback);
  }
}
