/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Silence app logging by default. Must come before
// require('../bin/persona-gmail-bridge');
const config = require('../lib/config');
if (config.get('logPath') === config.default('logPath') &&
    !process.env.LOG_PATH) {
  config.set('logPath', '/dev/null');
}

const url = require('url');
const querystring = require('querystring');
const assert = require('assert');

const bidCrypto = require('browserid-crypto');
// Fixme: don't use global cookie jar
const request = require('request').defaults({jar: true});
const google = require('../lib/google');

const app = require('../bin/persona-gmail-bridge');
const mockid = require('./lib/mockid');
const mookie = require('./lib/cookie');

const BASE_URL = 'http://localhost:3033';
const FORWARD_URL = BASE_URL + '/authenticate/forward';
const VERIFY_URL = BASE_URL + '/authenticate/verify';
const TEST_EMAIL = 'hikingfan@gmail.com';
const PROVEN_EMAIL = TEST_EMAIL;
const CLAIMED_EMAIL = 'hiking.fan+1@gmail.com';

/* globals describe, before, after, it */
/* jshint maxlen:120 */

describe('HTTP Endpoints', function () {
  var server;

  before(function (done) {
    google.setGoogleApis(mockid({
      url: 'http://oauth.example',
      result: {
        authenticated: true,
        email: TEST_EMAIL
      }
    }));
    server = app.listen(3033, undefined, undefined, done);
  });

  after(function () {
    server.close();
  });

  describe('/', function () {
    var url = BASE_URL + '/';
    var options = { followRedirect: false };

    it('should redirect to the Persona homepage', function(done) {
      request.get(url, options, function (err, res) {
        assert.equal(res.statusCode, 302);
        assert.equal(res.headers.location, config.get('server.personaUrl'));
        done(err);
      });
    });
  });

  describe('/ver.txt', function () {
    var url = BASE_URL + '/ver.txt';
    var options = { followRedirect: false };

    it('should redirect to the static ver.txt', function(done) {
      request.get(url, options, function (err, res) {
        assert.equal(res.statusCode, 302);
        assert.equal(res.headers.location, '/static/ver.txt');
        done(err);
      });
    });
  });

  describe('/__heartbeat__', function () {
    var url = BASE_URL + '/__heartbeat__';
    var res;
    var body;

    before(function (done) {
      request.get(url, function (err, _res, _body) {
        res = _res;
        body = _body;
        done(err);
      });
    });

    it('should respond to GET', function () {
      assert.equal(res.statusCode, 200);
    });

    it('should have an "ok" body', function () {
      assert.equal(body, 'ok');
    });
  });

  describe('/.well-known/browserid', function () {
    var url = BASE_URL + '/.well-known/browserid';
    var res;
    var body;

    before(function (done) {
      request.get(url, function (err, _res, _body) {
        res = _res;
        body = _body;
        done(err);
      });
    });

    it('should respond to GET', function () {
      assert.equal(res.statusCode, 200);
    });

    it('should use application/json', function () {
      var contentType = res.headers['content-type'].split(';')[0];
      assert.equal(contentType, 'application/json');
    });

    it('should be valid JSON', function () {
      assert.doesNotThrow(function () { JSON.parse(body); });
    });

    it('should contain all necessary parameters', function () {
      var doc = JSON.parse(body);
      assert.equal(doc.authentication, '/authenticate');
      assert.equal(doc.provisioning, '/provision');
      assert('public-key' in doc);
    });

    it('should contain a valid public key', function () {
      var doc = JSON.parse(body);
      var pubKey = JSON.stringify(doc['public-key']);
      assert(bidCrypto.loadPublicKey(pubKey));
    });
  });

  describe('/session', function() {
    var url = BASE_URL + '/session';

    describe('GET', function() {
      var res;
      var body;
      before(function(done) {
        request.get(url, function (err, _res, _body) {
          res = _res;
          body = _body;
          done(err);
        });
      });

      it('should respond to GET', function() {
        assert.equal(res.statusCode, 200);
      });

      it('should provide the CSRF token', function() {
        var json = JSON.parse(body);
        assert(json.csrf);
      });

      it('should deny XFRAME', function() {
        assert.equal(res.headers['x-frame-options'], 'DENY');
      });
    });

    describe('.proven', function() {
      it('should be equal to claimed email', function(done) {
        var jar = request.jar();
        var cookie = request.cookie('session=' + mookie({
          proven: PROVEN_EMAIL,
          claimed: CLAIMED_EMAIL
        }));
        jar.setCookie(cookie, url);

        request.get({ url: url, jar: jar }, function(err, res, body) {
          assert.ifError(err);

          var json = JSON.parse(body);
          assert.equal(json.proven, CLAIMED_EMAIL);
          done();
        });
      });

      it('should be false if mismatch', function(done) {
        var jar = request.jar();
        var cookie = request.cookie('session=' + mookie({
          proven: PROVEN_EMAIL,
          claimed: 'its.not.me@gmail.com'
        }));
        jar.setCookie(cookie, url);

        request.get({ url: url, jar: jar }, function(err, res, body) {
          assert.ifError(err);

          var json = JSON.parse(body);
          assert.equal(json.proven, false);
          done();
        });
      });
    });
  });

  describe('/provision', function () {
    var url = BASE_URL + '/provision';
    url; // Make JSHint shut up for the moment...
    describe('GET', function() {
      var res;
      var body;
      before(function(done) {
        request.get(url, function (err, _res, _body) {
          res = _res;
          body = _body;
          done(err);
        });
      });

      it('should NOT deny XFRAME', function() {
        assert.equal(res.headers['x-frame-options'], undefined);
      });
    });
  });

  describe('/provision/certify', function () {
    var url = BASE_URL + '/provision/certify';
    describe('well-formed requests', function () {
      var pubkey;

      before(function (done) {
        // Generate a public key for the signing request
        var keyOpts = { algorithm: 'RS', keysize: 64 };
        bidCrypto.generateKeypair(keyOpts, function (err, keypair) {
          pubkey = keypair.publicKey.serialize();
          done(err);
        });
      });

      it('should sign certificates', function (done) {
        var jar = request.jar();
        var cookie = request.cookie('session=' + mookie({ proven: PROVEN_EMAIL }));
        jar.setCookie(cookie, url);
        var options = {
          headers: { 'X-CSRF-Token': 'testSalt-5lTgCdom5sQd8ZQDXK8pvhCP5Go' },
          json: {
            email: CLAIMED_EMAIL,
            pubkey: pubkey,
            duration: 5 * 60 * 1000
          },
          jar: jar
        };

        request.post(url, options, function(err, res, body) {
          assert(bidCrypto.extractComponents(body.cert));
          done(err);
        });
      });
    });

    describe('malformed requests', function () {
      it('should have tests');
    });
  });

  describe('/authenticate', function () {
    var url = BASE_URL + '/authenticate';
    url; // Make JSHint shut up for the moment...
    it('should have tests');
  });

  describe('/authenticate/forward', function () {
    var url = FORWARD_URL;

    describe('well-formed requests', function () {
      var options = {
        qs: { email: 'hikingfan@gmail.com' },
        followRedirect: false
      };
      var res;
      var body;

      before(function (done) {
        request.get(url, options, function (err, _res, _body) {
          res = _res;
          body = _body;
          done(err);
        });
      });

      it('should respond to GET with a redirect', function () {
        assert.equal(res.statusCode, 302);
      });

      it('should redirect to the OAuth endpoint', function () {
        var location = res.headers.location;
        assert.ok(location.indexOf('http://oauth.example') > -1);
        assert.ok(location.indexOf('state=') > -1);
        assert.ok(location.indexOf(
              'scope=' + encodeURIComponent('openid email')) > -1);
        assert.ok(location.indexOf('openid.realm=') > -1);
        assert.ok(location.indexOf(
              'login_hint=' + encodeURIComponent(TEST_EMAIL)) > -1);
      });
    });

    describe('malformed requests', function () {
      it('should fail on GET for non-google addresses', function (done) {
        var options = {
          qs: { email: 'hikingfan@example.invalid' },
          followRedirect: false
        };

        request.get(url, options, function (err, res) {
          assert.equal(res.statusCode, 400);
          done(err);
        });
      });

      it('should fail on GET if no email is provided', function (done) {
        var options = {
          qs: { },
          followRedirect: false
        };

        request.get(url, options, function (err, res) {
          assert.equal(res.statusCode, 400);
          done(err);
        });
      });
    });
  });

  describe('/authenticate/verify', function () {
    describe('well-formed requests', function() {
      it('should succeed if code is specified, returned email matches claimed email', function(done) {
        // use a cookieJar so session information (claimed email, state token,
        // etc) is remembered between requests.
        var cookieJar = request.jar();
        var forwardOptions = {
          followRedirect: false,
          url: FORWARD_URL,
          jar: cookieJar,
          qs: {
            email: TEST_EMAIL
          }
        };

        request(forwardOptions, function (err, res) {
          // fetch the state token out of the forward URL
          var parsedLocation = url.parse(res.headers.location);
          var queryParams = querystring.parse(parsedLocation.query);

          var verifyOptions = {
            url: VERIFY_URL,
            jar: cookieJar,
            qs: {
              'code': 'thisisafakecode',
              'state': queryParams.state
            }
          };

          request(verifyOptions, function (err, res) {
            assert.equal(res.statusCode, 200);
            done(err);
          });
        });
      });
    });

    describe('malformed requests', function() {
      it('should fail if misisng state token', function (done) {
        var options = {
          qs: {
            code: 'thisisafakecode'
          }
        };

        request.get(VERIFY_URL, options, function(err, res) {
          assert.equal(res.statusCode, 400);
          done(err);
        });
      });

      it('should fail if state token does not match expected', function (done) {
        var cookieJar = request.jar();
        var forwardOptions = {
          followRedirect: false,
          url: FORWARD_URL,
          jar: cookieJar,
          qs: {
            email: TEST_EMAIL
          }
        };

        request(forwardOptions, function () {
          var verifyOptions = {
            url: VERIFY_URL,
            jar: cookieJar,
            qs: {
              code: 'thisisafakecode',
              state: 'invalidstatetoken'
            }
          };

          request(verifyOptions, function (err, res) {
            assert.equal(res.statusCode, 400);
            done(err);
          });
        });
      });

      it('should fail if code is missing', function(done) {
        var options = {
          qs: {
            state: 'validstatetoken',
          }
        };

        request.get(VERIFY_URL, options, function(err, res) {
          assert.equal(res.statusCode, 400);
          done(err);
        });
      });
    });
  });
});
