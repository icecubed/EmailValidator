var q = require('q');
var dns = require('dns');
var _ = require('underscore');


module.exports = function(app) {
  // console.log(app.get('externalIpAddress'));
  var validatorController = {

    functions: {
      getMxRecord: function(domain) {
        var defer = q.defer();

        dns.resolveMx(domain, function(error, addresses) {
          if (error) {
            defer.reject(error);
          } else {
            // properly sort the mx records
            var addressList = _.chain(addresses).sortBy(function(item) {
              return item.priority;
            }).pluck("exchange").value();
            defer.resolve(addressList);
          }
        });

        return defer.promise;
      },

      getARecord: function(domain) {
        var dnsResolve = q.denodeify(dns.resolve);

        console.log("start getARecord");

        return dnsResolve(domain).timeout(1000);
      },

      checkMailExchanger: function(domain) {
        var redis = require('redis'),
          redisClient = redis.createClient();
        var expires = 60 * 60; //one hour


        var checkMx = function(domain) {
          var defer = q.defer();
          setTimeout(function() {
            defer.reject("timeout")
          }, 2000);

          var net = require('net');
          var client = net.connect({
              port: 25,
              host: domain
            },
            function() {
              client.write('helo ' + app.get('externalIpAddress') + '\r\n');
            });
          client.on('data', function(data) {
            console.log(data.toString());
            client.end();
            defer.resolve(true);
          });

          client.on('error', function(error) {
            console.log('error: ', error);
            defer.reject(error);
          })
          client.on('end', function() {
            defer.resolve("disconnected");
          });

          return defer.promise;
        }

        var checkCache = function(domain) {
          var defer = q.defer();
          redisClient.get(domain, function(err, reply) {
            if (!err && (reply !== null)) {
              defer.resolve(reply);
            } else {
              defer.reject(err);
            }
          });
          return defer.promise;
        }

        var Q = q.defer();

        checkCache(domain).then(function(data) {
          if (data === "true") {
            Q.resolve(data);
          } else {
            Q.reject(data);
          }
        }).
        catch (function(error) {
          checkMx(domain).then(function(data) {
            console.log("found mx");
            redisClient.set(domain, data, function(err, reply) {
              console.log("err", err, "reply", reply);
              redisClient.expire(domain, expires, redis.print);
              Q.resolve(true);
            });
          }).
          catch (function(error) {
            console.log("not found mx");
            var test = redisClient.set(domain, false);
            console.log("finished not mx found, ", test);
            redisClient.expire(domain, expires, redis.print);
            Q.reject("could not find a mail server to deliver to.");
          });
        });

        return Q.promise;
      },

      checkRfcCompliance: function(domain) {
        return "Not yet implemented";
      }

    },

    checkEmailAddress: function(email) {
      var defer = q.defer();

      if (email.length < 5) {
        defer.reject({
          email: email,
          valid: false,
          reason: "not a valid email, too short"
        });
      }

      var parts = email.split("@");
      if (parts[0].length > 64)
        defer.reject({
          email: email,
          valid: false,
          reason: "mailbox too long (64 chars)"
        });

      if (parts.length != 2) {
        defer.reject({
          email: email,
          valid: false,
          reason: "not a valid email format"
        });
      }

      var mailbox = parts[0];
      var hostname = parts[1];

      this.functions.getMxRecord(hostname).then(function(data) {
        // to do, try all mx records
        return validatorController.functions.checkMailExchanger(data[0]);

      },
      function() {
        var Q = q.defer();

        validatorController.functions.getARecord(hostname).then(function(data) {
          validatorController.functions.checkMailExchanger(data[0]).then(function(data) {
            Q.resolve(data);
          }).
          catch (function() {
            Q.reject("no server to receive mail. cannot connect to mail exchanger");
          })
        }).
        catch (function() {
          Q.reject("cannot resolve domain name");
        });

        return Q.promise;
      }).then(function(data) {
      defer.resolve({
        email: email,
        valid: data
      });
    }).
    catch (function(error) {
      defer.reject({
        email: email,
        valid: false,
        reason: error
      });
    });

    return defer.promise;
  }

};
return validatorController;
}