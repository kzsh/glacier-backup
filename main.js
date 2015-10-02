var crypto = require('crypto');
var Promise = require('bluebird');
var config = require('./config/config.js');
var fs = require('fs');
var AWS = require('aws-sdk');

config.configure(AWS);
var startTime = new Date();

function run () {
  'use strict';
  var glacier = new AWS.Glacier();
  var params = {
    vaultName: config.vaultName,
    partSize: config.partSize.toString()
  };

  var initiateMultipartUpload =
    Promise.promisify(glacier.initiateMultipartUpload, glacier);
  var uploadMultipartPart =
    Promise.promisify(glacier.uploadMultipartPart, glacier);
  var completeMultipartUpload =
    Promise.promisify(glacier.completeMultipartUpload, glacier);

  initiateMultipartUpload(params).then(function (multipart) {
    console.log('Got upload ID', multipart.uploadId);

    var chunkBegin = 0;

    var partsPromises = [];
    var hashes = [];
    var stream = getStream(process.argv[2]);
      //TODO: there's a difference of when readable
      //fires and when you think it fires.

      stream.on('readable', function() {
      var chunk;

      while (null !== (chunk = this.read(config.partSize))) {
        var chunkEnd = chunkBegin + chunk.length -1;
        var hash = glacier.computeChecksums(chunk).treeHash;
        hashes.push(hash);
        // set params
        var partParams = {
          vaultName: config.vaultName,
          uploadId: multipart.uploadId,
          checksum: hash,
          range: buildRange(chunkBegin, chunkEnd),
          body: chunk
        };
        console.log('Uploading part', chunkBegin, '=', partParams.range);
        // Send a single part
        partsPromises.push(
          uploadMultipartPart(partParams).then(function() {
            console.log('Completed part', partParams.range); //TODO: losing real data here.
          }).catch(function (multiErr) {
            // TODO: if the error is a timeout, retry.
            // or abort here?
            console.log(multiErr);
          })
        );
        chunkBegin = chunkEnd + 1;
      }
    });
    stream.on('end', function() {
      console.log('setting complete handler');
      setCompletionHandler(partsPromises, multipart, hashes, glacier);
    });
    stream.on( "error", function( error ) {
      this.emit( "end" );
    });
  }).catch(function (mpErr) {
    // abort here?
    //https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Glacier.html#abortMultipartUpload-property
    console.log('Error!', mpErr.stack);
  });
}

function getStream(path) {
  'use strict';
  return fs.createReadStream(path, {
    flags: 'r',
    autoClose: true
  });
}

function buildRange(bufferBegin, bufferEnd) {
  'use strict';
  return 'bytes ' + bufferBegin + '-' + bufferEnd + '/*';
}

// TODO: this or the stream read should be a generator.
function setCompletionHandler(partsPromises, multipart, hashes, glacier) {
  'use strict';
  // complete only when all parts uploade

  Promise.all(partsPromises).then(function() {

    var archiveSize = fs.statSync(process.argv[2]).size.toString();

    console.log('hashes', hashes.join(''))
    var doneParams = {
      vaultName: config.vaultName,
      uploadId: multipart.uploadId,
      archiveSize: archiveSize,

      checksum: calculateTreeHash(hashes) // the computed tree hash
    };

    console.log('Completing upload...');
    glacier.completeMultipartUpload(doneParams, function(err, data) {
      if (err) {
        console.log('An error occurred while uploading the archive');
        console.log(err);
      } else {
        var delta = (new Date() - startTime) / 1000;
        console.log('Completed upload in', delta, 'seconds');
        console.log('Archive ID:', data.archiveId);
        console.log('Checksum:  ', data.checksum);
      }
    });
  }).catch(function (err) {
    console.log('error doing?', err);
  });
}
function calculateTreeHash(hashes) {
  if (hashes.length === 1) {
    return hashes[0];
  }
  combinedHashes = [];
  for(var current = 0; current < hashes.length; current += 2) {
    var next = current + 1;
    var calculatedHash;
    if(!hashes[next]) {
       calculatedHash = hashes[current];
    } else {

       calculatedHash =
        crypto.createHash('sha256')
          .update(hashes[current] + hashes[next]).digest('hex');
    }
    combinedHashes.push(calculatedHash);
  }
  return calculateTreeHash(combinedHashes);
}

run();
