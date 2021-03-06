'use strict'

var crypto = require('crypto')
var dcopy = require('deep-copy')

// oauth configuration
var oauth = require('../config/oauth.json')
// reserved keys
var reserved = require('../config/reserved.json')


// generate provider options
var initProvider = (provider, options, server, name) => {

  // merge provider options with user options


  // cleanup empty values in custom_params
  ;(() => {
    if (options.custom_params) {
      var params = options.custom_params
      for (var key in params) {
        if (!params[key]) {
          delete params[key]
        }
      }
      if (!Object.keys(params).length) {
        delete options.custom_params
      }
    }
  })()

  // set reserved keys
  reserved.forEach((key) => {
    var value = options[key] || server[key] || provider[key]
    if (value) {
      provider[key] = value
    }
  })


  // transformations


  // provider shortcuts
  if (name) {
    provider[name] = true
    provider.name = name
  }


  // oauth credentials
  ;(() => {
    var key, secret
    if (provider.oauth === 1) {
      key = provider.consumer_key || provider.key
      secret = provider.consumer_secret || provider.secret
    }
    else if (provider.oauth === 2) {
      key = provider.client_id || provider.key
      secret = provider.client_secret || provider.secret
    }
    if (key) {
      provider.key = key
    }
    if (secret) {
      provider.secret = secret
    }
  })()


  // oauth scope
  if (provider.scope) {
    if (provider.scope instanceof Array) {
      provider.scope = provider.scope.join(provider.scope_delimiter || ',')
    }
    else if (typeof provider.scope === 'object') {
      provider.scope = JSON.stringify(provider.scope)
    }
  }


  // custom_parameters
  ;(() => {
    if (provider.custom_parameters) {
      var params = provider.custom_params || {}
      for (var key in options) {
        if (reserved.indexOf(key) === -1 &&
            provider.custom_parameters.indexOf(key) !== -1) {

          params[key] = options[key]
        }
      }
      if (Object.keys(params).length) {
        provider.custom_params = params
      }
    }
  })()


  // static overrides
  ;(() => {
    var overrides = {}
    for (var key in options) {
      if (provider.custom_parameters &&
          provider.custom_parameters.indexOf(key) !== -1) {
        continue
      }

      if (reserved.indexOf(key) === -1 &&
          typeof options[key] === 'object') {

        overrides[key] = initProvider(dcopy(provider), options[key], {})
      }
    }
    if (Object.keys(overrides).length) {
      provider.overrides = overrides
    }
  })()


  return provider
}

// initialize all configured providers
var init = (config) => {
  config = config || {}
  var server = config.server || {}

  // generate provider options
  var result = {}
  for (var key in config) {
    if (key === 'server') {
      continue
    }
    var provider = dcopy(oauth[key] || {})
    var options = config[key] || {}

    var generated = initProvider(provider, options, server, key)
    result[generated.name] = generated
  }

  result.server = server
  return result
}

// oauth state transform
var state = (provider) => {
  var state
  if (typeof provider.state === 'string' || typeof provider.state === 'number') {
    state = provider.state.toString()
  }
  else if (typeof provider.state === 'boolean' && provider.state) {
    state = crypto.randomBytes(10).toString('hex')
  }
  return state
}

// get provider on connect
var provider = (config, session) => {
  var name = session.provider
  var provider = config[name]
  var options = {}
  var server = config.server || {}

  if (!provider) {
    if (oauth[name]) {
      provider = dcopy(oauth[name])
      provider = initProvider(provider, options, server, name)

      config[provider.name] = provider
    }
    else {
      provider = {}
    }
  }

  if (session.override && provider.overrides) {
    var override = provider.overrides[session.override]
    if (override) {
      provider = override
    }
  }

  if (session.dynamic) {
    provider = dcopy(provider)
    options = session.dynamic
    provider = initProvider(provider, options, server)
  }

  if (provider.state) {
    provider = dcopy(provider)
    provider.state = state(provider)
  }

  return provider
}

module.exports = {initProvider, init, state, provider}
