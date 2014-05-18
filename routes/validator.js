var express = require('express');
var router = express.Router();

module.exports = function(app) {
  var validatorController = require('../controllers/validatorController')(app);

  /* GET users listing. */
  router.get('/:email', function(req, res) {

    validatorController.checkEmailAddress(req.params.email).then(function(data) {
      res.send(data);
    }, function(error) {
      res.send(error);
    }).done();


  });

  router.get('/mxtest/:domain', function(req, res) {

    validatorController.functions.checkMailExchanger(req.params.domain).then(function(data) {
      res.send(data);
    }, function(error) {
      res.send(error);
    }).done();


  });

  return router;
}