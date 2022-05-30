/**
 * Copyright 2016 IBM Corp. All Rights Reserved.
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
var Cloudant = require('@cloudant/cloudant');
var async = require('async');
var fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

/**
 * This action is triggered by a new check image added to a CouchDB database.
 * This action is idempotent. If it fails, it can be retried.
 *
 * 1. Fetch the record from the 'audited' database and find its attachment along with
 *    deposit to and account information.
 * 2. Process the image for deposit to account, routing number and move it to
 *    another 'parsed' database with metadata and a confidence score.
 *
 * @param   params._id                        The id of the inserted record in the Cloudant 'audit' database that triggered this action
 * @param   params.attachmentName
 * @param   params.CLOUDANT_HOST              Cloudant endpoint (HOST)
 * @param   params.CLOUDANT_USERNAME          Cloudant username
 * @param   params.CLOUDANT_PASSWORD          Cloudant password
 * @param   params.CLOUDANT_AUDITED_DATABASE  Cloudant database to store the original copy to
 * @param   params.CLOUDANT_PARSED_DATABASE   Cloudant database to store the parsed check data to
 * @param   params.CLOUDANT_REJECTED_DATABASE Cloudant database to store the rejected check data to
 * @return                                    Standard OpenWhisk success/error response
 */

/*

main(params);
*/

function main(params) {

  // Configure database connection
  var cloudant = new Cloudant({
    url: params.CLOUDANT_HOST,
    account: params.CLOUDANT_USERNAME,
    password: params.CLOUDANT_PASSWORD
  });

  var parsedDb = cloudant.db.use(params.CLOUDANT_PARSED_DATABASE);
  var rejectedDb = cloudant.db.use(params.CLOUDANT_REJECTED_DATABASE);

  // Data to extract from check and send along to the transaction system to process.
  var email;
  var toAccount;
  var fromAccount;
  var plainMicrCheckText;
  var routingNumber;
  var amount;
  var timestamp;

  // We're only interested in changes to the database if they're inserts
  if (!params.deleted) {

    return new Promise(function(resolve, reject) {
      async.waterfall([

          function(callback) {
            console.log('Retreiving access_token..');
            getIAMToken(params.CFXN_API_KEY).then((access_token) => {
              return callback(null, access_token);
            }).catch((err) => {
              return callback(err);
            })
          },

          // OCR magic. Takes image, reads it, returns fromAccount, routingNumber
          function(access_token, callback) {
            console.log('[parse-check-data.main] Executing OCR parse of check');
            asyncCallOcrParseAction("openchecks/parse-check-with-ocr",
              params.CLOUDANT_USERNAME,
              params.CLOUDANT_PASSWORD,
              params.CLOUDANT_AUDITED_DATABASE,
              params._id,
              params.attachmentName,
              params,
              access_token,
              callback
            );
          },

          // Insert data into the parsed database.
          function(activation, callback) {

            plainMicrCheckText = Buffer.from(activation.result.result.plaintext, 'base64').toString("ascii");
            console.log('Plain text: ' + plainMicrCheckText);

            var values = params.fileName.split('^');
            email = values[0];
            toAccount = values[1];
            amount = values[2];
            //timestamp = values[3].substring(0, values[3].length - 4); // Remove file extension
            timestamp = parseInt(new Date().getTime() / 1000, 10);

            var bankingInfo = parseMicrDataToBankingInformation(plainMicrCheckText);
            if (bankingInfo.invalid()) {
              console.log('Inserting in REJECTEDDB, id ' + params._id + ", amount = " + amount);
              rejectedDb.insert({
                  _id: params._id,
                  toAccount: toAccount,
                  fromAccount: -1,
                  routingNumber: -1,
                  email: email,
                  amount: amount,
                  timestamp: timestamp
                },
                function(err, body, head) {
                  if (err) {
                    console.log('[parse-check-data.main] error: rejectedDb');
                    console.log(err);
                    return callback(err);
                  } else {
                    console.log('[parse-check-data.main] success: rejectedDb');
                    console.log(body);
                    return callback(null);
                  }
                }
              );
            } else {
              fromAccount = bankingInfo.accountNumber;
              routingNumber = bankingInfo.routingNumber;
              //fromAccount = activation.result.result.account;
              //routingNumber = activation.result.result.routing;

              console.log('Inserting in PARSEDDB, id ' + params._id + ", amount = " + amount);
              parsedDb.insert({
                  _id: params._id,
                  toAccount: toAccount,
                  fromAccount: fromAccount,
                  routingNumber: routingNumber,
                  email: email,
                  amount: amount,
                  timestamp: timestamp
                },
                function(err, body, head) {
                  if (err) {
                    console.log('[parse-check-data.main] error: parsedDb');
                    console.log(err);
                    return callback(err);
                  } else {
                    console.log('[parse-check-data.main] success: parsedDb');
                    console.log(body);
                    return callback(null);
                  }
                }
              );
            }
          },
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

  } else {
    return Promise.resolve({
      status: "Success"
    });
  }

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
function asyncCallOcrParseAction(actionName, cloudantUser, cloudantPass, database, id, attachmentName, params, access_token, callback) {
  console.log("Calling", actionName, "for", id);

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

  wsk.actions.invoke({
    "actionName": actionName,
    "params": {
      CLOUDANT_USERNAME: cloudantUser,
      CLOUDANT_PASSWORD: cloudantPass,
      CLOUDANT_HOST: params.CLOUDANT_HOST,
      CLOUDANT_AUDITED_DATABASE: database,
      IMAGE_ID: id,
      ATTACHMENT_NAME: attachmentName
    },
    blocking: true
  }).then(
    function(activation) {
      console.log(actionName, "[activation]", activation);
      callback(null, activation.response);
    }
  ).catch(
    function(error) {
      console.log(actionName, "[error]", error);
      callback(error);
    }
  );

}

/**
 * @param  {string} routingNumber
 * @param  {string} accountNumber
 * @class
 */
function BankCheckMicrInformation(routingNumber, accountNumber) {
  this.routingNumber = routingNumber;
  this.accountNumber = accountNumber;
  this.invalid = function() {
    return this.routingNumber.length != 9 || this.accountNumber.length === 2;
  }
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

    const iamURL = "https://iam.cloud.ibm.com/oidc/token";
    
    return new Promise((resolve, reject) => {
      fetch(iamURL, options).then(response => 
        response.json()
      ).then(data => {
        return resolve(data.access_token);
      }).catch(err => {
        reject(err)
      })
    })
}

/**
 * @param  {string} micrCheckRawInformation
 * @return {BankCheckMicrInformation}
 */
function parseMicrDataToBankingInformation(micrCheckRawInformation) {
  if (typeof micrCheckRawInformation !== "string")
    throw new Error("Invalid Micr information");
  if (micrCheckRawInformation.length === 0)
    throw new Error("Invalid Micr information");

  var routingRegExp = /\[\d{9}\[/gm;
  var routingMatches = micrCheckRawInformation.match(routingRegExp);
  if (routingMatches === null || routingMatches.length === 0)
    return new BankCheckMicrInformation("-1", "0");
  if (routingMatches.length > 1)
    return new BankCheckMicrInformation("-2", "0");
  var routingNumber = routingMatches[0].substring(1, 10);

  var accountRegExp = /(\[\d{9}\[)( ?)([0-9A-Z]+@)/igm;
  var accountMatches = accountRegExp.exec(micrCheckRawInformation);

  console.log("Matches for account number: ");
  console.log(accountMatches);
  if (accountMatches === null || accountMatches.length === 0)
    return new BankCheckMicrInformation(routingNumber, "-1");
  if (accountMatches.length > 4)
    return new BankCheckMicrInformation(routingNumber, "-2");
  var accountNumber = accountMatches[3].replace("@", "");

  return new BankCheckMicrInformation(routingNumber, accountNumber);
}

exports.main = main;