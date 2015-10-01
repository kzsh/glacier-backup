var crypto = require('crypto');
var config = require('./config.js')
var fs = require('fs');
var AWS = require('aws-sdk');

config.configure(AWS);
var glacier = new AWS.Glacier();
var done = false;
var hash = crypto.createHash('sha256');
var startTime = new Date();
var checksum = null;
var params = {vaultName: config.vaultName, partSize: config.partSize.toString()};
var archiveSize = fs.statSync(process.argv[2])["size"]

var stream = getStream();

glacier.initiateMultipartUpload(params, function (mpErr, multipart) {
  if (mpErr) { console.log('Error!', mpErr.stack); return; }
  console.log("Got upload ID", multipart.uploadId);

  var currentBufferIndex = 0;
  stream.on('readable', function() {

    var chunk;
    while (null !== (chunk = stream.read(config.partSize))) {

      console.log(chunk.length);
      var currentBufferEnd = currentBufferIndex + chunk.length;
      // set params
      partParams = {
        vaultName: config.vaultName,
        uploadId: multipart.uploadId,
        range: 'bytes ' + currentBufferIndex + '-' + (currentBufferEnd -1) + '/*',
        body: chunk.slice(currentBufferIndex, currentBufferEnd)
      };

      // Send a single part
      console.log('Uploading part', currentBufferIndex, '=', partParams.range);
      glacier.uploadMultipartPart(partParams, function(multiErr, mData) {
        if (multiErr) {
          console.log(multiErr);
          return;
        }
        console.log("Completed part", this.request.params.range);

         // complete only when all parts uploade
        console.log(currentBufferEnd, archiveSize);
        if (currentBufferEnd < archiveSize) return;
        var doneParams = {
          vaultName: config.vaultName,
          uploadId: multipart.uploadId,
          archiveSize: archiveSize,
          checksum: hash.digest('hex')// the computed tree hash
        };

        console.log("Completing upload...");
        glacier.completeMultipartUpload(doneParams, function(err, data) {
          if (err) {
            console.log("An error occurred while uploading the archive");
            console.log(err);
          } else {
            var delta = (new Date() - startTime) / 1000;
            console.log('Completed upload in', delta, 'seconds');
            console.log('Archive ID:', data.archiveId);
            console.log('Checksum:  ', data.checksum);
          }
        });
      });
      hash.update(chunk)

      currentBufferIndex = currentBufferEnd;
    }
  });
});

function getStream() {
  return fs.createReadStream(process.argv[2], {
    flags: 'r',
    encoding: 'utf8',
    autoClose: true
  });
}
