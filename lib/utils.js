'use strict'

var qs = require('qs')


var redirect_uri = (provider) =>
  provider.redirect_uri ||
  [
    provider.protocol,
    '://',
    provider.host,
    (provider.path || ''),
    '/connect/',
    provider.name,
    '/callback'
  ].join('')

var toQuerystring = (provider, body, err) => {
  var data
  try {
    data = JSON.parse(body)
  }
  catch (e) {
    data = qs.parse(body)
  }

  var result = {}
  if (provider.concur) {
    result.access_token = body.replace(
      /[\s\S]+<Token>([^<]+)<\/Token>[\s\S]+/, '$1')
    result.refresh_token = body.replace(
      /[\s\S]+<Refresh_Token>([^<]+)<\/Refresh_Token>[\s\S]+/, '$1')
    data = body
  }
  else if (provider.elance) {
    result.access_token = data.data.access_token
    result.refresh_token = data.data.refresh_token
  }
  else if (provider.getpocket) {
    result.access_token = data.access_token
  }
  else if (provider.yammer) {
    result.access_token = data.access_token.token
  }

  else if (provider.oauth === 1) {
    for (var key in data) {
      if (key === 'oauth_token') {
        result.access_token = data.oauth_token
      }
      else if (key === 'oauth_token_secret') {
        result.access_secret = data.oauth_token_secret
      }
    }
  }
  else if (provider.oauth === 2) {
    for (var key in data) {
      if (key === 'access_token') {
        result.access_token = data.access_token
      }
      else if (key === 'refresh_token') {
        result.refresh_token = data.refresh_token
      }
    }
  }

  result[err ? 'error' : 'raw'] = data
  return qs.stringify(result)
}

var error = (err) =>
  !err.raw
    ? toQuerystring({}, {error: err.message}, true)
    : toQuerystring({}, err.raw, true)

module.exports = {redirect_uri, toQuerystring, error}
