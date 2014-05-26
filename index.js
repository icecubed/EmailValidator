var q = require('q');
var externalAddressController = require('controllers/externalAddressController');
var emailValidatorController = require('controllers/emailValidatorController');

var EmailValidator = {
  checkEmailAddress: function(email, options, callback) {
    emailValidatorController.checkEmailAddress(email, options).then(function(data) {
      callback(null, data);
    }, function(error) {
      callback(error, null);
    });

  },

  getExternalIp: function(callback) {
    externalAddressController.getAddress().then(function(data) {
      callback(null, data);
    }, function(error) {
      callback(error, null);
    });
  }

};

module.exports = EmailValidator;

