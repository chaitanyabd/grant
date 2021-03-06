'use strict'

var t = require('assert')
var qs = require('qs')
var request = require('request')
var urlib = require('url')

var express = require('express')
var session = require('express-session')

var Koa = require('koa')
var koasession = require('koa-session')
var mount = require('koa-mount')
var convert = require('koa-convert')
var koaqs = require('koa-qs')

var Hapi = require('hapi')
var yar = require('yar')

var Grant = require('../../')

var _Koa = Koa
Koa = function () {
  var version = parseInt(require('koa/package.json').version.split('.')[0])

  var app = new _Koa()

  if (version >= 2) {
    var _use = app.use
    app.use = (mw) => _use.call(app, convert(mw))
  }

  return app
}


describe('consumer - error', () => {
  var url = (path) =>
    `${config.server.protocol}://${config.server.host}${path}`

  var config = {
    server: {protocol: 'http', host: 'localhost:5000', callback: '/'},
    facebook: {}, twitter: {}
  }

  ;['express', 'koa', 'hapi'].forEach((name) => {
    describe(`missing middleware - session - ${name}`, () => {
      var server, consumer = name

      var servers = {
        express: (done) => {
          var grant = Grant.express()(config)
          var app = express().use(grant)
          app.use((err, req, res, next) => {
            t.equal(err.message, 'Grant: mount session middleware first')
            next()
          })
          server = app.listen(5000, done)
        },
        koa: (done) => {
          var grant = Grant.koa()(config)
          var app = new Koa()
          app.use(function* (next) {
            try {
              yield next
            }
            catch (err) {
              t.equal(err.message, 'Grant: mount session middleware first')
            }
          })
          app.use(mount(grant))
          server = app.listen(5000, done)
        },
        hapi: (done) => {
          var grant = Grant.hapi()()
          server = new Hapi.Server({debug: {request: false}})
          server.connection({host: 'localhost', port: 5000})

          server.register([{register: grant, options: config}], (err) => {
            if (err) {
              done(err)
              return
            }

            server.on('request-error', (req, err) => {
              t.equal(err.message, 'Uncaught error: Grant: register session plugin first')
            })

            server.start(done)
          })
        }
      }

      before((done) => {
        servers[consumer](done)
      })

      it('throw', (done) => {
        request.get(url('/connect/facebook'), {
          jar: request.jar(),
          json: true
        }, done)
      })

      after((done) => {
        server[/express|koa/.test(consumer) ? 'close' : 'stop'](done)
      })
    })
  })

  ;['express', 'koa', 'hapi'].forEach((name) => {
    describe(`missing middleware - body-parser - ${name}`, () => {
      var server, consumer = name

      var servers = {
        express: (done) => {
          var grant = Grant.express()(config)
          var app = express()
          app.use(session({secret: 'grant', saveUninitialized: true, resave: true}))
          app.use(grant)
          app.use((err, req, res, next) => {
            t.equal(err.message, 'Grant: mount body parser middleware first')
            next()
          })
          server = app.listen(5000, done)
        },
        koa: (done) => {
          var grant = Grant.koa()(config)
          var app = new Koa()
          app.keys = ['grant']
          app.use(koasession(app))
          app.use(function* (next) {
            try {
              yield next
            }
            catch (err) {
              t.equal(err.message, 'Grant: mount body parser middleware first')
            }
          })
          app.use(mount(grant))
          server = app.listen(5000, done)
        },
        hapi: (done) => {
          var grant = Grant.hapi()()

          server = new Hapi.Server()
          server.connection({host: 'localhost', port: 5000})

          server.route({method: 'GET', path: '/authorize_url', handler: (req, res) => {
            res.redirect(url('/connect/facebook/callback?' +
              qs.stringify({error: {message: 'invalid', code: '500'}})))
          }})
          server.route({method: 'GET', path: '/', handler: (req, res) => {
            var parsed = urlib.parse(req.url, false)
            var query = qs.parse(parsed.query)
            res(query)
          }})

          server.register([
            {register: grant, options: config},
            {register: yar, options: {cookieOptions: {password: '01234567890123456789012345678912', isSecure: false}}}
          ], (err) => {
            if (err) {
              done(err)
              return
            }

            grant.config.facebook.authorize_url = url('/authorize_url')

            server.start(done)
          })
        }
      }

      before((done) => {
        servers[consumer](done)
      })

      it('throw', (done) => {
        request.post(url('/connect/facebook'), {
          jar: request.jar(),
          json: true
        }, done)
      })

      after((done) => {
        server[/express|koa/.test(consumer) ? 'close' : 'stop'](done)
      })
    })
  })

  ;['express', 'koa', 'hapi'].forEach((name) => {
    describe(`oauth2 - authorize - missing code + response message - ${name}`, () => {
      var server, grant, consumer = name

      var servers = {
        express: (done) => {
          grant = Grant.express()(config)
          var app = express()
          app.use(session({secret: 'grant', saveUninitialized: true, resave: true}))
          app.use(grant)

          grant.config.facebook.authorize_url = url('/authorize_url')

          app.get('/authorize_url', (req, res) => {
            res.redirect(url('/connect/facebook/callback?' +
              qs.stringify({error: {message: 'invalid', code: '500'}})))
          })

          app.get('/', (req, res) => {
            res.end(JSON.stringify(req.session.grant.response || req.query))
          })

          server = app.listen(5000, done)
        },
        koa: (done) => {
          grant = Grant.koa()(config)

          var app = new Koa()
          app.keys = ['grant']
          app.use(koasession(app))
          app.use(mount(grant))
          koaqs(app)

          grant.config.facebook.authorize_url = url('/authorize_url')

          app.use(function* () {
            if (this.path === '/authorize_url') {
              this.response.redirect(url('/connect/facebook/callback?' +
                qs.stringify({error: {message: 'invalid', code: 500}})))
            }
            else if (this.path === '/') {
              this.body = JSON.stringify(this.session.grant.response || this.request.query)
            }
          })

          server = app.listen(5000, done)
        },
        hapi: (done) => {
          grant = Grant.hapi()()

          server = new Hapi.Server()
          server.connection({host: 'localhost', port: 5000})

          server.route({method: 'GET', path: '/authorize_url', handler: (req, res) => {
            res.redirect(url('/connect/facebook/callback?' +
              qs.stringify({error: {message: 'invalid', code: '500'}})))
          }})
          server.route({method: 'GET', path: '/', handler: (req, res) => {
            var parsed = urlib.parse(req.url, false)
            var query = qs.parse(parsed.query)
            res((req.session || req.yar).get('grant').response || query)
          }})

          server.register([
            {register: grant, options: config},
            {register: yar, options: {cookieOptions: {password: '01234567890123456789012345678912', isSecure: false}}}
          ], (err) => {
            if (err) {
              done(err)
              return
            }

            grant.config.facebook.authorize_url = url('/authorize_url')

            server.start(done)
          })
        }
      }

      before((done) => {
        servers[consumer](done)
      })

      it('authorize', (done) => {
        var assert = (message, done) => {
          request.get(url('/connect/facebook'), {
            jar: request.jar(),
            json: true
          }, (err, res, body) => {
            t.deepEqual(
              body,
              {error: {error: {message: 'invalid', code: '500'}}},
              message
            )
            done()
          })
        }
        delete grant.config.facebook.transport
        assert('no transport', () => {
          grant.config.facebook.transport = 'querystring'
          assert('querystring transport', () => {
            grant.config.facebook.transport = 'session'
            assert('session transport', done)
          })
        })
      })

      after((done) => {
        server[/express|koa/.test(consumer) ? 'close' : 'stop'](done)
      })
    })
  })

  ;['express', 'koa', 'hapi'].forEach((name) => {
    describe(`oauth2 - authorize - missing code without response message - ${name}`, () => {
      var server, grant, consumer = name

      var servers = {
        express: (done) => {
          grant = Grant.express()(config)
          var app = express()
          app.use(session({secret: 'grant', saveUninitialized: true, resave: true}))
          app.use(grant)

          grant.config.facebook.authorize_url = url('/authorize_url')

          app.get('/authorize_url', (req, res) => {
            res.redirect(url('/connect/facebook/callback'))
          })

          app.get('/', (req, res) => {
            res.end(JSON.stringify(req.session.grant.response || req.query))
          })

          server = app.listen(5000, done)
        },
        koa: (done) => {
          grant = Grant.koa()(config)

          var app = new Koa()
          app.keys = ['grant']
          app.use(koasession(app))
          app.use(mount(grant))
          koaqs(app)

          grant.config.facebook.authorize_url = url('/authorize_url')

          app.use(function* () {
            if (this.path === '/authorize_url') {
              this.response.redirect(url('/connect/facebook/callback'))
            }
            else if (this.path === '/') {
              this.body = JSON.stringify(this.session.grant.response || this.request.query)
            }
          })

          server = app.listen(5000, done)
        },
        hapi: (done) => {
          grant = Grant.hapi()()

          server = new Hapi.Server()
          server.connection({host: 'localhost', port: 5000})

          server.route({method: 'GET', path: '/authorize_url', handler: (req, res) => {
            res.redirect(url('/connect/facebook/callback'))
          }})
          server.route({method: 'GET', path: '/', handler: (req, res) => {
            var parsed = urlib.parse(req.url, false)
            var query = qs.parse(parsed.query)
            res((req.session || req.yar).get('grant').response || query)
          }})

          server.register([
            {register: grant, options: config},
            {register: yar, options: {cookieOptions: {password: '01234567890123456789012345678912', isSecure: false}}}
          ], (err) => {
            if (err) {
              done(err)
              return
            }

            grant.config.facebook.authorize_url = url('/authorize_url')

            server.start(done)
          })
        }
      }

      before((done) => {
        servers[consumer](done)
      })

      it('authorize', (done) => {
        var assert = (message, done) => {
          request.get(url('/connect/facebook'), {
            jar: request.jar(),
            json: true
          }, (err, res, body) => {
            t.deepEqual(
              body,
              {error: {error: 'Grant: OAuth2 missing code parameter'}},
              message
            )
            done()
          })
        }
        delete grant.config.facebook.transport
        assert('no transport', () => {
          grant.config.facebook.transport = 'querystring'
          assert('querystring transport', () => {
            grant.config.facebook.transport = 'session'
            assert('session transport', done)
          })
        })
      })

      after((done) => {
        server[/express|koa/.test(consumer) ? 'close' : 'stop'](done)
      })
    })
  })

  ;['express', 'koa', 'hapi'].forEach((name) => {
    describe(`oauth2 - authorize - state mismatch - ${name}`, () => {
      var server, grant, consumer = name

      var servers = {
        express: (done) => {
          grant = Grant.express()(config)
          var app = express()
          app.use(session({secret: 'grant', saveUninitialized: true, resave: true}))
          app.use(grant)

          grant.config.facebook.authorize_url = url('/authorize_url')
          grant.config.facebook.state = 'Grant'

          app.get('/authorize_url', (req, res) => {
            res.redirect(url('/connect/facebook/callback?' +
              qs.stringify({code: 'code', state: 'Purest'})))
          })

          app.get('/', (req, res) => {
            res.end(JSON.stringify(req.session.grant.response || req.query))
          })

          server = app.listen(5000, done)
        },
        koa: (done) => {
          grant = Grant.koa()(config)

          var app = new Koa()
          app.keys = ['grant']
          app.use(koasession(app))
          app.use(mount(grant))
          koaqs(app)

          grant.config.facebook.authorize_url = url('/authorize_url')
          grant.config.facebook.state = 'Grant'

          app.use(function* () {
            if (this.path === '/authorize_url') {
              this.response.redirect(url('/connect/facebook/callback?' +
                qs.stringify({code: 'code', state: 'Purest'})))
            }
            else if (this.path === '/') {
              this.body = JSON.stringify(this.session.grant.response || this.request.query)
            }
          })

          server = app.listen(5000, done)
        },
        hapi: (done) => {
          grant = Grant.hapi()()

          server = new Hapi.Server()
          server.connection({host: 'localhost', port: 5000})

          server.route({method: 'GET', path: '/authorize_url', handler: (req, res) => {
            res.redirect(url('/connect/facebook/callback?' +
              qs.stringify({code: 'code', state: 'Purest'})))
          }})
          server.route({method: 'GET', path: '/', handler: (req, res) => {
            var parsed = urlib.parse(req.url, false)
            var query = qs.parse(parsed.query)
            res((req.session || req.yar).get('grant').response || query)
          }})

          server.register([
            {register: grant, options: config},
            {register: yar, options: {cookieOptions: {password: '01234567890123456789012345678912', isSecure: false}}}
          ], (err) => {
            if (err) {
              done(err)
              return
            }

            grant.config.facebook.authorize_url = url('/authorize_url')
            grant.config.facebook.state = 'Grant'

            server.start(done)
          })
        }
      }

      before((done) => {
        servers[consumer](done)
      })

      it('authorize', (done) => {
        var assert = (message, done) => {
          request.get(url('/connect/facebook'), {
            jar: request.jar(),
            json: true
          }, (err, res, body) => {
            t.deepEqual(
              body,
              {error: {error: 'Grant: OAuth2 state mismatch'}},
              message
            )
            done()
          })
        }
        delete grant.config.facebook.transport
        assert('no transport', () => {
          grant.config.facebook.transport = 'querystring'
          assert('querystring transport', () => {
            grant.config.facebook.transport = 'session'
            assert('session transport', done)
          })
        })
      })

      after((done) => {
        server[/express|koa/.test(consumer) ? 'close' : 'stop'](done)
      })
    })
  })

  ;['express', 'koa', 'hapi'].forEach((name) => {
    describe(`oauth2 - access - error response - ${name}`, () => {
      var server, grant, consumer = name

      var servers = {
        express: (done) => {
          grant = Grant.express()(config)
          var app = express()
          app.use(session({secret: 'grant', saveUninitialized: true, resave: true}))
          app.use(grant)

          grant.config.facebook.authorize_url = url('/authorize_url')
          grant.config.facebook.access_url = url('/access_url')

          app.get('/authorize_url', (req, res) => {
            res.redirect(url('/connect/facebook/callback?code=code'))
          })

          app.post('/access_url', (req, res) => {
            res.status(500).end(qs.stringify({error: {message: 'invalid', code: '500'}}))
          })

          app.get('/', (req, res) => {
            res.end(JSON.stringify(req.session.grant.response || req.query))
          })

          server = app.listen(5000, done)
        },
        koa: (done) => {
          grant = Grant.koa()(config)

          var app = new Koa()
          app.keys = ['grant']
          app.use(koasession(app))
          app.use(mount(grant))
          koaqs(app)

          grant.config.facebook.authorize_url = url('/authorize_url')
          grant.config.facebook.access_url = url('/access_url')

          app.use(function* () {
            if (this.path === '/authorize_url') {
              this.response.redirect(url('/connect/facebook/callback?code=code'))
            }
            else if (this.path === '/access_url') {
              this.response.status = 500
              this.body = qs.stringify({error: {message: 'invalid', code: 500}})
            }
            else if (this.path === '/') {
              this.body = JSON.stringify(this.session.grant.response || this.request.query)
            }
          })

          server = app.listen(5000, done)
        },
        hapi: (done) => {
          grant = Grant.hapi()()

          server = new Hapi.Server()
          server.connection({host: 'localhost', port: 5000})

          server.route({method: 'GET', path: '/authorize_url', handler: (req, res) => {
            res.redirect(url('/connect/facebook/callback?code=code'))
          }})
          server.route({method: 'POST', path: '/access_url', handler: (req, res) => {
            res(qs.stringify({error: {message: 'invalid', code: '500'}})).code(500)
          }})
          server.route({method: 'GET', path: '/', handler: (req, res) => {
            var parsed = urlib.parse(req.url, false)
            var query = qs.parse(parsed.query)
            res((req.session || req.yar).get('grant').response || query)
          }})

          server.register([
            {register: grant, options: config},
            {register: yar, options: {cookieOptions: {password: '01234567890123456789012345678912', isSecure: false}}}
          ], (err) => {
            if (err) {
              done(err)
              return
            }

            grant.config.facebook.authorize_url = url('/authorize_url')
            grant.config.facebook.access_url = url('/access_url')

            server.start(done)
          })
        }
      }

      before((done) => {
        servers[consumer](done)
      })

      it('access', (done) => {
        var assert = (message, done) => {
          request.get(url('/connect/facebook'), {
            jar: request.jar(),
            json: true
          }, (err, res, body) => {
            t.deepEqual(
              body,
              {error: {error: {message: 'invalid', code: '500'}}},
              message
            )
            done()
          })
        }
        delete grant.config.facebook.transport
        assert('no transport', () => {
          grant.config.facebook.transport = 'querystring'
          assert('querystring transport', () => {
            grant.config.facebook.transport = 'session'
            assert('session transport', done)
          })
        })
      })

      after((done) => {
        server[/express|koa/.test(consumer) ? 'close' : 'stop'](done)
      })
    })
  })

  ;['express', 'koa', 'hapi'].forEach((name) => {
    describe(`missing session or misconfigured provider - ${name}`, () => {
      var server, grant, consumer = name, jar = request.jar()

      var servers = {
        express: (done) => {
          grant = Grant.express()(config)
          var app = express()
          app.use(session({secret: 'grant', saveUninitialized: true, resave: true}))
          app.use(grant)

          app.get('/', (req, res) => {
            res.writeHead(200, {'x-test': true})
            res.end(JSON.stringify(req.session.grant.response || req.query))
          })
          server = app.listen(5000, done)
        },
        koa: (done) => {
          grant = Grant.koa()(config)
          var app = new Koa()
          app.keys = ['grant']
          app.use(koasession(app))
          app.use(mount(grant))
          koaqs(app)

          app.use(function* () {
            if (this.path === '/') {
              this.response.set('x-test', true)
              this.body = JSON.stringify(this.session.grant.response || this.request.query)
            }
          })

          server = app.listen(5000, done)
        },
        hapi: (done) => {
          grant = Grant.hapi()()

          server = new Hapi.Server()
          server.connection({host: 'localhost', port: 5000})

          server.route({method: 'GET', path: '/', handler: (req, res) => {
            var parsed = urlib.parse(req.url, false)
            var query = qs.parse(parsed.query)
            res((req.session || req.yar).get('grant').response || query).header('x-test', true)
          }})

          server.register([
            {register: grant, options: config},
            {register: yar, options: {cookieOptions: {password: '01234567890123456789012345678912', isSecure: false}}}
          ], (err) => {
            if (err) {
              done(err)
              return
            }

            server.start(done)
          })
        }
      }

      before((done) => {
        servers[consumer](done)
      })

      it('no flow - /connect + callback', (done) => {
        delete grant.config.facebook.oauth
        var assert = (message, done) => {
          request.get(url('/connect/facebook'), {
            jar,
            json: true
          }, (err, res, body) => {
            t.equal(res.headers['x-test'], 'true')
            t.deepEqual(
              body,
              {error: 'Grant: missing or misconfigured provider'},
              message
            )
            done()
          })
        }
        delete grant.config.facebook.transport
        assert('no transport', () => {
          grant.config.facebook.transport = 'querystring'
          assert('querystring transport', () => {
            grant.config.facebook.transport = 'session'
            assert('session transport', done)
          })
        })
      })

      it('no flow - /connect without callback', (done) => {
        delete grant.config.facebook.callback
        request.get(url('/connect/facebook'), {
          jar,
          json: true
        }, (err, res, body) => {
          t.equal(res.headers['x-test'], undefined)
          t.deepEqual(qs.parse(body), {
            error: 'Grant: missing or misconfigured provider'})
          done()
        })
      })

      it('no flow - /callback + callback', (done) => {
        grant.config.facebook.callback = '/'
        var assert = (message, done) => {
          request.get(url('/connect/facebook/callback'), {
            jar,
            json: true
          }, (err, res, body) => {
            t.equal(res.headers['x-test'], 'true')
            t.deepEqual(body, {
              error: 'Grant: missing session or misconfigured provider'})
            done()
          })
        }
        delete grant.config.facebook.transport
        assert('no transport', () => {
          grant.config.facebook.transport = 'querystring'
          assert('querystring transport', () => {
            grant.config.facebook.transport = 'session'
            assert('session transport', done)
          })
        })
      })

      it('no flow - /callback without callback', (done) => {
        delete grant.config.facebook.callback
        request.get(url('/connect/facebook/callback'), {
          jar,
          json: true
        }, (err, res, body) => {
          t.equal(res.headers['x-test'], undefined)
          t.deepEqual(qs.parse(body), {
            error: 'Grant: missing session or misconfigured provider'})
          done()
        })
      })

      after((done) => {
        server[/express|koa/.test(consumer) ? 'close' : 'stop'](done)
      })
    })
  })
})
