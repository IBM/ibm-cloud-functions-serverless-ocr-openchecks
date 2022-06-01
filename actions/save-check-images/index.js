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
var uuid = require('uuid');
var gm = require('gm').subClass({
  imageMagick: true
});
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
var Cloudant = require('@cloudant/cloudant');
var ibm = require('ibm-cos-sdk');
const { promisify } = require('util');
const { pipeline} = require('stream');


// local env

/**
 * This action is invoked when new check images are found in object storage.
 * This action is idempotent. If it fails, it can be retried.
 *
 * 1. Retrieve the image from object storage
 * 2. Resize the image into two additional copies at 50% and 25%
 * 3. Store the resized images into an archive database for use by other applications
 * 4. Store the original image into an audit database to initiate the OCR scan in another action
 *
 * @param   params.CLOUDANT_USERNAME                        Cloudant username
 * @param   params.CLOUDANT_PASSWORD                        Cloudant password
 * @param   params.CLOUDANT_HOST                            Cloudant Host
 * @param   params.CLOUDANT_ARCHIVED_DATABASE               Cloudant database to store the resized copies to
 * @param   params.CLOUDANT_AUDITED_DATABASE                Cloudant database to store the original copy to
 * @param   params.OBJECT_STORAGE_API_KEY                   Object storage api key
 * @param   params.OBJECT_STORAGE_CRN                       Object storage crn
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
  // Configure database connection
  var cloudant = new Cloudant({
    url: params.CLOUDANT_HOST,
    account: params.CLOUDANT_USERNAME,
    password: params.CLOUDANT_PASSWORD,
  });
  var archivedDb = cloudant.db.use(params.CLOUDANT_ARCHIVED_DATABASE);
  var auditedDb = cloudant.db.use(params.CLOUDANT_AUDITED_DATABASE);

  // Configure object storage connection
  var os = new ObjectStorage(
    params.OBJECT_STORAGE_REGION_NAME, 
    params.OBJECT_STORAGE_API_KEY, 
    params.OBJECT_STORAGE_CRN
  );

  // For the 50% and 25% scaled images and image type
  var medFileName = "300px-" + params.fileName;
  var smFileName = "150px-" + params.fileName;
  var fileExtension = params.fileName.split('.').pop();

  // This chains together the following functions serially, so that if there's an error along the way,
  // the check isn't deleted and this can be called again idempotently.
  return new Promise(function(resolve, reject) {
    async.waterfall([

      function(callback) {
        console.log("Authenticating", params.OBJECT_STORAGE_INCOMING_CONTAINER_NAME);
        os.authenticate(callback).then(() => {
          return callback(null);
        }).catch(err => {
          console.log("error", err);
        })
      },

        // Get the file on disk as a temp file
        function(callback) {
          console.log("Downloading", params.fileName);
          os.downloadFile(params.OBJECT_STORAGE_INCOMING_CONTAINER_NAME, params.fileName, fs.createWriteStream(params.fileName), function(err) {
            return callback(err);
          }).then(() => {
            return callback(null);
          })
        },

        // Copy and resize the file to two smaller versions
        function(callback) {
          console.log("Creating resized images.");
          if (fileExtension == "bmp" || fileExtension == "jpg" || fileExtension == "png" || fileExtension == "gif") {
            console.log("Resizing image to 300px wide");
            gm(params.fileName).resize(300).write(medFileName, function(err) {
              if (err) {
                console.log("300px resize error: " + err);
                return callback(err);
              } else {
                console.log("Resizing image to 150px wide");
                gm(params.fileName).resize(150).write(smFileName, function(err) {
                  if (err) {
                    console.log("150px resize error: " + err);
                    return callback(err);
                  }
                  return callback(null);
                });
              }
            });
          } else {
            return callback("File is not an image.");
          }
        },

        // Open original file to memory and send it to the next function
        function(callback) {
          console.log("Opening original file");
          fs.readFile(params.fileName, function(err, data) {
            if (err) {
              console.log("Error reading original file.");
              return callback(err);
            } else {
              console.log("Success reading original file.");
              return callback(null, data);
            }
          });
        },

        
        // Save original image data to Cloudant with an enriched name
        function(data, callback) {
          var uuid1 = uuid.v1();
          var attachmentName = "att-" + uuid1;
          console.log("Attempting insert of original image into the audited database. Id = " + uuid1);

          var values = params.fileName.split('^');
          var email = values[0];
          var toAccount = values[1];
          var amount = values[2];

          auditedDb.multipart.insert({
              fileName: params.fileName,
              attachmentName: attachmentName,
              email: email,
              toAccount: toAccount,
              amount: amount,
              timestamp: (new Date()).getTime()
            }, [{
              name: attachmentName,
              data: data,
              content_type: params.contentType
            }],
            uuid1,
            function(err, body) {
              if (err && err.statusCode != 409) {
                console.log("Error with original file insert.");
                return callback(err);
              } else {
                console.log("Success with original file insert.");
                return callback(null);
              }
            }
          );
        },

  
        // Open medium file to memory and send it to the next function
        function(callback) {
          console.log("Opening medium file");
          fs.readFile(medFileName, function(err, data) {
            if (err) {
              console.log("Error reading medium file.");
              return callback(err);
            } else {
              console.log("Success reading medium file.");
              return callback(null, data);
            }
          });
        },

        // Save medium file to Cloudant with an enriched name
        function(data, callback) {
          if (!data) return callback(null);
          console.log("Attempting Cloudant insert of medium image into the archived database.");
          var uuid1 = uuid.v1();
          var attachmentName = uuid.v1(); //I'd rather use a simple md5 hash, but it's not available
          archivedDb.multipart.insert({
              fileName: medFileName,
              attachmentName: attachmentName
            }, [{
              name: attachmentName,
              data: data,
              content_type: params.contentType
            }],
            uuid1,
            function(err, body) {
              if (err && err.statusCode != 409) {
                console.log("Error with Cloudant medium insert.");
                return callback(err);
              } else {
                console.log("Success with Cloudant medium file insert.");
                return callback(null);
              }
            }
          );
        },

        // Open small file to memory and send it to the next function
        function(callback) {
          console.log("Opening small file");
          fs.readFile(smFileName, function(err, data) {
            if (err) {
              console.log("Error reading small file.");
              return callback(err);
            } else {
              console.log("Success reading small file.");
              return callback(null, data);
            }
          });
        },

        // Save small file to Cloudant with an enriched name
        function(data, callback) {
          if (!data) return callback(null);
          console.log("Attempting Cloudant insert of small image into the archived database.");
          var uuid1 = uuid.v1();
          var attachmentName = uuid.v1(); //I'd rather use a simple md5 hash, but it's not available
          archivedDb.multipart.insert({
              fileName: smFileName,
              attachmentName: attachmentName
            }, [{
              name: attachmentName,
              data: data,
              content_type: params.contentType
            }],
            uuid1,
            function(err, body) {
              if (err && err.statusCode != 409) {
                console.log("Error with Cloudant small file insert.");
                return callback(err);
              } else {
                console.log("Success with Cloudant small file insert.");
                return callback(null);
              }
            }
          );
        },

        // When all the steps above have completed successfully, delete the file from the incoming folder
        function(callback) {
          console.log("Deleting processed file from", params.OBJECT_STORAGE_INCOMING_CONTAINER_NAME);
          os.deleteFile(params.OBJECT_STORAGE_INCOMING_CONTAINER_NAME, params.fileName, function(err) {
            if (err) {
              console.log(err);
              return callback(err);
            } else {
              console.log('deleted')
              return callback(null);
            }
          });
        }
      ],
      function(err, result) {
        if (err) {
          console.log("Error", err);
          reject(err);
        } else {
          resolve({
            status: "Success"
          });
        }
      }
    );

  });

}

/**
 * This is an adapter class for OpenStack OBJECT_STORAGE based object storage.
 *
 * @param   region      The id of the record in the Cloudant 'processed' database
 * @param   projectId   Cloudant username (set once at action update time)
 * @param   userId      Cloudant password (set once at action update time)
 * @param   password    Cloudant password (set once at action update time)
 * @return              The reference to a configured object storage instance
 */
function ObjectStorage(region, apiKey, osInstanceId) {
  var self = this;

  self.baseUrl = "https://s3." + region + ".cloud-object-storage.appdomain.cloud/"

  var config = {
    endpoint: self.baseUrl,
    apiKeyId: apiKey,
    serviceInstanceId: osInstanceId
  }

  var cos = new ibm.S3(config);

  self.authenticate = function(callback) {
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

    const iamURL = "https://iam.cloud.ibm.com/oidc/token";
    
    return new Promise((resolve, reject) => {
      fetch(iamURL, options).then(response => 
        response.json()
      ).then(data => {
        self.token = data.access_token;
        resolve(data.access_token);
      }).catch(err => {
        reject(err)
      })
    })
  }

  self.downloadFile = function(container, file, outputStream, callback) {
    return new Promise((resolve, reject) => {
    fetch(self.baseUrl + container + "/" + file, 
      {
        method: 'GET',
        headers: {
          'Authorization': "Bearer " + self.token
      }     
    }).then(data => {
        const streamPipe = promisify(pipeline)
        resolve(streamPipe(data.body, outputStream));
    }).catch(err => {
      reject(err); 
    })
   })
  };

  self.deleteFile = function(container, file, callback) {
    return new Promise((resolve, reject) => {
      fetch(self.baseUrl + container + "/" + file,
        {
          method: 'DELETE',
          headers: {
            'Authorization': "Bearer " + self.token
          }
        }
      ).then((response) => {
        resolve(response);
      }).catch((err) => {
        reject(err);
      })
    })
  };
}

exports.main = main;
