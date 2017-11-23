var q = require('q');
var dns = require('dns');
var _ = require('underscore');
var async = require('async');



var functions = {
  /**
   * [getMxRecord returns a string array of Mx records for a given domain]
   * @param  {string} domain  the input domain
   * @return {Q.Promise<Array>} x {string}
   */
  getMxRecord: function(domain) {
    var defer = q.defer();

    dns.resolveMx(domain, function(error, addresses) {
      if (error) {
        defer.reject(error);
      } else {
        // properly sort the mx records
        var addressList = _.chain(addresses)
          .sortBy(function(item) {

            return item.priority;
          })
          .pluck('exchange')
          .value();
        defer.resolve(addressList);
      }
    });

    return defer.promise;
  },

  getARecord: function(domain) {

    console.log(' -- -- -- start getARecord');

    var defer = q.defer();

    // timeout
    setTimeout(function() {
      defer.reject({
        domain: domain,
        success: false,
        response: 'timeout'
      });
    }, 5000);

    dns.resolve(domain, function(err, addresses) {
      if (err) {
        defer.reject(err);
      } else {
        defer.resolve(addresses);
      }
    });

    return defer.promise;
  },

  checkMailExchanger: function(domain, options, isMxRecord) {
    // var redis = require('redis'),
    //   redisClient = redis.createClient(options.redisPort, options.redisHost);
    // var expiresFailed = 60 * 60; //one hour
    // var expiresSuccess = 60 * 60 * 72; // 3 days


    var checkMx = function(domain) {
      var defer = q.defer();
      var client;
      setTimeout(function() {
        if (client && client.end) {
          client.end();
        }
        defer.reject({
          domain: domain,
          success: false,
          response: 'timeout'
        });
      }, 40000);

      var net = require('net');
      var gotData = false;
      console.log(' -- -- -- connecting to ' + domain /*+ ' from ' + options.externalIpAddress*/);
      client = net.connect({
          port: 25,
          host: domain
        },
        function() {
          console.log(' -- -- -- connected to ' + domain /*+ ' from ' + options.externalIpAddress*/);
          //client.write('helo ' + options.externalIpAddress + '\r\n');
          // client.end();
          // defer.resolve(true);
        });
      client.on('data', function(data) {
        console.log(' -- -- -- reply from ' + domain + ':: ' + data.toString());
        gotData = false;
        client.end();
        defer.resolve({
          domain: domain,
          success: true,
          response: data.toString()
        });
      });

      client.on('error', function(error) {
        console.log(' -- -- -- error connecting to ' + domain + ':: ', error);
        defer.reject({
          domain: domain,
          success: false,
          response: error
        });
      });
      client.on('end', function() {
        console.log(' -- -- -- connection ended to ' + domain);
        if (gotData) {
          return defer.resolve({
            domain: domain,
            success: true,
            response: 'disconnected'
          });
        }
        return defer.reject({
          domain: domain,
          success: false,
          response: 'disconnected'
        });
      });

      return defer.promise;
    };

    var checkCache = function(domain) {
      var defer = q.defer();
      options.redisClient.get(`emailDomain::${domain}`, function(err, reply) {
        if (!err && (reply !== null)) {
          defer.resolve(reply);
        } else {
          defer.reject(err);
        }
      });
      return defer.promise;
    };

    var Q = q.defer();

    checkCache(domain)
      .then(function(data) {
        console.log(' -- -- -- data from cache ', require('util')
          .inspect(data, {
            depth: 3
          }));
        if (data && typeof data !== "object")
          data = JSON.parse(data);
        if (data.success) {
          Q.resolve(data);
        } else {
          Q.reject(data);
        }
      })
      .catch(function(error) {
        checkMx(domain)
          .then(function(data) {
            console.log(' -- -- -- found mx');
            options.redisClient.set(`emailDomain::${domain}`, JSON.stringify(data), function(err, reply) {
              console.log(' -- -- -- redis reply', err, 'reply', reply);
              options.redisClient.expire(`emailDomain::${domain}`, options.redisexpiresSuccess, options.redisClient.print);
              Q.resolve(data);
            });
          })
          .catch(function(error) {
            console.log(' -- -- -- mx not found');
            var test = options.redisClient.set(`emailDomain::${domain}`, JSON.stringify(error));
            console.log(' -- -- -- finished mx not found, ', test);
            options.redisClient.expire(`emailDomain::${domain}`, options.redisexpiresFailed, options.redisClient.print);
            error.errorMsg = 'could not find a mail server to deliver to.'
            Q.reject(error);
          });
      });

    return Q.promise;
  },

  /**
   * Check's email address for RFC compliance. Not implemented, should probably be removed.
   * @param  {String} domain domain name
   * @return {String}        Not implemented!
   */
  checkRfcCompliance: function(domain) {
    return 'Not yet implemented';
  },

  /**
   * Get ARecord then check email exchanger
   * @param  {string} hostname Host name
   * @param  {object} options  Options
   * @return {Promise}         Promise resolve with True, reject with false
   */
  checkEmailExchangerForARecord: function(hostname, options) {
    var Q = q.defer();
    // get ARecord by hostname
    functions.getARecord(hostname)
      .then(function(aRecords) {
        // check mail exchanger for aRecord
        console.log(' -- -- -- gotARecord now checking MX', aRecords);
        options.result.aRecord.records = aRecords;
        var isMxRecord = false;
        return functions.checkMailExchanger(aRecords[0], options, isMxRecord);
      })
      .then(function(data) {
        options.result.aRecord.checked.push(data);
        Q.resolve(data);
      })
      .catch(function(error) {
        options.result.aRecord.checked.push(error);
        console.log(' -- -- -- cannot resolve domain name or mail exchanger');
        Q.reject('cannot resolve domain name or mail exchanger');
      });
    return Q.promise;
  }

};


/**
 * the module for the validatorController
 * @return {Object}
 */

// console.log(app.get('externalIpAddress'));
var validatorController = {

  /**
   * checks email address for validity, checking syntax and mail servers.
   * @param {String} email email address
   * @param {Object} options the options object
   * @return {Q.Promise<Object>}
   */
  checkEmailAddress: function(email, options) {
    var defer = q.defer();

    var result = {
      email: email,
      mailbox: '',
      hostname: '',
      valid: false,
      reason: '',
      mxRecord: {
        records: [],
        checked: []
      },
      aRecord: {
        records: [],
        checked: []
      },
      start_time: new Date().getTime()
    };

    // copy options over base
    options = _.extend({
      externalIpAddress: '',
      redisPort: 6379,
      redisHost: '127.0.0.1',
      redisexpiresFailed: 60 * 60, //one hour
      redisexpiresSuccess: 60 * 60 * 24 * 3, // 3 days
      result: result,
      domainKey: _.template("emailDomain::<%= domain %>"),
    }, options);

    if(!options.redisClient){
      var  redis = require('redis');
      options.redisClient = redis.createClient(options.redisPort, options.redisHost);
    }

    if (email.length < 5) {
      result.valid = false;
      result.reason = 'not a valid email, too short';
      result.end_time = new Date().getTime();
      defer.reject(result);
    }

    var parts = email.split('@');
    if (parts[0].length > 64) {
      result.valid = false;
      result.reason = 'mailbox too long (64 chars)';
      result.end_time = new Date().getTime();
      defer.reject(result);
    }
    if (parts.length != 2) {
      result.valid = false;
      result.reason = 'not a valid email format';
      result.end_time = new Date().getTime();
      defer.reject(result);
    }

    var mailbox = parts[0];
    var hostname = parts[1];
    result.mailbox = mailbox;
    result.hostname = hostname;

    console.log(' -- -- -- geting MX record for ' + hostname);

    functions.getMxRecord(hostname)
      // get all MxRecords successfully
      .then(function(mxRecords) {
        console.log(' -- -- -- got MX records for ' + hostname, mxRecords);
          var Q = q.defer();
          result.mxRecord.records = mxRecords;
          // to do, try all mx records
          //return functions.checkMailExchanger(data[0], options.externalIpAddress);
          async.detect(mxRecords,
            // iterate each item in data array and find the first mxRecord which can resolve email exchanger
            function(mxRecord, callback) {
              var isMxRecord = true;
              // check email exchange by mxRecord and external ip address
              functions.checkMailExchanger(mxRecord, options, isMxRecord)
                .then(function(data) {
                  result.mxRecord.checked.push(data);
                  callback(true);
                })
                .catch(function(error) {
                  result.mxRecord.checked.push(error);
                  callback(false);
                });
            },
            function(mxRecord) {
              console.log(' -- -- -- mxRecord:', mxRecord);
              if (mxRecord) {
                Q.resolve(true);
              } else {
                console.log(' -- -- -- no server to receive mail.' +
                  ' cannot connect to any mail exchanger ' +
                  JSON.stringify(mxRecords));
                Q.reject(' no server to receive mail.' +
                  ' cannot connect to any mail exchanger ');
                // try to get ARecord then check
                //return functions.checkEmailExchangerForARecord(hostname, options);
              }
            });
          return Q.promise;
        },
        // no mxRecord
        function(err) {
          var Q = q.defer();
          Q.reject('No MX records found.');
          return Q.promise;
          //return functions.checkEmailExchangerForARecord(hostname, options);
        })
      .then(function(data) {
        result.valid = true;
        result.end_time = new Date().getTime();
        defer.resolve(result);
      })
      .catch(function(error) {
        result.valid = false;
        result.end_time = new Date().getTime();
        result.reason = error
        defer.reject(result);
      });

    return defer.promise;
  }

};


/**
 * checks the email address for validity
 * @type {{checkEmailAddress: checkEmailAddress}}
 */
module.exports = validatorController;
