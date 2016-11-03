var Cloudant = require('cloudant');
var async = require('async');
var fs = require('fs');

/**
 * This action is triggered by a new check image added to a CouchDB database.
 * This action is idempotent. If it fails, it can be retried.
 *
 * 1. Fetch the record from the 'audited' database and find its attachment along with 
 *    deposit to and account information.
 * 2. Process the image for deposit to account, routing number and move it to 
 *    another 'parsed' database with metadata and a confidence score.
 *
 * @param   params.id                        The id of the inserted record in the Cloudant 'audit' database that triggered this action
 * @param   params.CLOUDANT_USER             Cloudant username
 * @param   params.CLOUDANT_PASS             Cloudant password
 * @param   params.CLOUDANT_AUDITED_DATABASE Cloudant database to store the original copy to
 * @param   params.CLOUDANT_PARSED_DATABASE  Cloudant database to store the parsed check data to 
 * @param   params.CURRENT_NAMESPACE         The current namespace so we can call the OCR action by name 
 * @return                                   Standard OpenWhisk success/error response
 */
function main(params) {
    
    // Configure database connection
    console.log(params);
    console.log(params.id);
    var cloudant = new Cloudant({
      account:  params.CLOUDANT_USER,
      password: params.CLOUDANT_PASS
    });
    var auditedDb = cloudant.db.use(params.CLOUDANT_AUDITED_DATABASE);
    var parsedDb = cloudant.db.use(params.CLOUDANT_PARSED_DATABASE);

    // Data to extract from check and send along to the transaction system to process.
    var fileName;
    var email;
    var toAccount;
    var fromAccount;
    var routingNumber;
    var amount;
    var timestamp;

    // We're only interested in changes to the database if they're inserts
    if (!params.deleted) {

      async.waterfall([

        // OCR magic. Takes image, reads it, returns fromAccount, routingNumber
        function (callback) {
          console.log('[parse-check-data.main] Executing OCR parse of check');
          asyncCallOcrParseAction("/" + params.CURRENT_NAMESPACE + "/parse-check-with-ocr",
            params.CLOUDANT_USER,
            params.CLOUDANT_PASS,
            params.CLOUDANT_AUDITED_DATABASE,
            params.id,
            callback
          );
        },

        // Insert data into the parsed database.
        function (activation, callback) {
          console.log('[parse-check-data.main] Inserting into the parsed database');
          
          console.log(activation);

          fromAccount = activation.result.result.account;
          routingNumber = activation.result.result.routing;

          var values = params.id.split('^');
          email = values[0];
          toAccount = values[1];
          amount = values[2];
          timestamp = values[3].substring(0, values[3].length - 4); // Remove file extension

          parsedDb.insert(
            {
              _id: params.id,
              toAccount: toAccount,
              fromAccount: fromAccount,
              routingNumber: routingNumber,
              email: email,
              amount: amount,
              timestamp: timestamp
            },
            function (err, body, head) {
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
        },

      ],

        function (err, result) {
          if (err) {
            console.log("[KO]", err);
          } else {
            console.log("[OK]");
          }
          whisk.done(null, err);
        }
    );

  }

  return whisk.async();
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
function asyncCallOcrParseAction(actionName, cloudantUser, cloudantPass, database, id, callback) {
  console.log("Calling", actionName, "for", id);
  whisk.invoke({
    name: actionName,
    parameters: {
      CLOUDANT_USER: cloudantUser,
      CLOUDANT_PASS: cloudantPass,
      CLOUDANT_AUDITED_DATABASE: database,
      IMAGE_ID: id
    },
    blocking: true,
    next: function (err, activation) {
      if (err) {
        console.log(actionName, "[error]", error);
        return callback(err);
      } else {
        console.log(actionName, "[activation]", activation);
        return callback(null, activation);
      }
    }
  });
}