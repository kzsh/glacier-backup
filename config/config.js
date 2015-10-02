
module.exports = {
  configure: function (AWS) {
    AWS.config.region = this.region;
    AWS.config.logger = this.logger;
  },
  region: 'us-east-1',
  vaultName: "music-archive",
  logger: null, //process.stdout,
  partSize: 1024 * 1024,
}
