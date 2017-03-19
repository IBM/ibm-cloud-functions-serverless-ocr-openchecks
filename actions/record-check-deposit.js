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
var Cloudant = require('cloudant');
var request = require('request');
var async = require('async');

/**
 * This action is fired in response to newly parsed check data. It then contacts an external payment system and sends a notification.
 * This action is idempotent. If it fails, it can be retried.
 *
 * 1. Fetch the record from the 'parsed' database: to and from account numbers, amount, and confidence.
 * 2. Insert it into the 'processed' database which an external system would use, or otherwise invoke that other system.
 * 3. Send an email notification to the customer that their check has been processed.
 *
 * @param   params._id                            The id of the record in the Cloudant 'processed' database
 * @param   params.CLOUDANT_USER                 Cloudant username
 * @param   params.CLOUDANT_PASS                 Cloudant password
 * @param   params.CLOUDANT_PARSED_DATABASE      Cloudant database to retrieve the parsed from
 * @param   params.CLOUDANT_PROCESSSED_DATABASE  Cloudant database to store the processed data to
 * @param   params.SENDGRID_API_KEY              Cloudant password
 * @param   params.SENDGRID_FROM_ADDRESS         Address to set as sender
 * @return                                       Standard OpenWhisk success/error response
 */
function main(params) {

  var wsk = openwhisk();

  // Configure database connection
  console.log(params);
  var cloudant = new Cloudant({
    account: params.CLOUDANT_USER,
    password: params.CLOUDANT_PASS
  });
  var processedDb = cloudant.db.use(params.CLOUDANT_PROCESSED_DATABASE);

  if (!params.deleted) {

    var processed = {};
    processed._id = params._id;
    processed.toAccount = params.toAccount;
    processed.fromAccount = params.fromAccount;
    processed.routingNumber = params.routingNumber;
    processed.email = params.email;
    processed.amount = params.amount;
    processed.timestamp = params.timestamp;

    return new Promise(function(resolve, reject) {
      async.waterfall([

          // Insert the check data into the processed database.
          function(callback) {
            console.log('[record-check-deposit.main] Updating the processed database');
            processedDb.insert(processed, function(err, body, head) {
              if (err) {
                console.log('[record-check-deposit.main] error: processedDb');
                console.log(err);
                return callback(err);
              } else {
                console.log('[record-check-deposit.main] success: processedDb');
                console.log(body);
                return callback(null, processed);
              }
            });
          },

          // Send email notification, simulating connectivity to backend system and notifying customer.
          function(processed, callback) {
            console.log('[record-check-deposit.main] Sending notification email');

            subject = 'Check deposit accepted';
            content = 'Hello, ';
            content += 'your deposit for $' + processed.amount + ' was accepted into your account ' + processed.toAccount + ' on ' + format(processed.timestamp) + '. ';
            content += 'For reference, the check number and routing number were: ' + processed.fromAccount + '-' + processed.routingNumber + '. ';

            console.log("Mailing: " + '{"personalizations": [{"to": [{"email": "' + processed.email + '"}]}],"from": {"email": "check.deposit@catabase.org"},"subject": "' + subject + '","content": [{"type": "text/plain", "value": "' + content + '"}]}');

            request({
              url: 'https://api.sendgrid.com/v3/mail/send',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + params.SENDGRID_API_KEY
              },
              body: '{"personalizations": [{"to": [{"email": "' + processed.email + '"}]}],"from": {"email": "' + params.SENDGRID_FROM_ADDRESS + '"},"subject": "' + subject + '","content": [{"type": "text/plain", "value": "' + content + '"}]}'
            }, function(err, response, body) {
              if (err) {
                console.log('[record-check-deposit.main] error: ');
                console.log(err);
                callback(err);
                return;
              } else {
                console.log('[record-check-deposit.main] success: ');
                console.log(body);
                callback(null);
                return;
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

}

/**
 * This function converts from a Unix timestamp into a human readable date
 *
 * @param   timestamp    The Unix timestamp
 * @return               The formatted string
 */
function format(timestamp) {
  var warranty_expiration_date = new Date(timestamp * 1000);
  return (warranty_expiration_date.getMonth() + 1) + '/' + warranty_expiration_date.getDate() + '/' + warranty_expiration_date.getFullYear();
}
