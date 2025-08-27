// temporary 
const fs = require('fs')
const pickBy = require('lodash/pickBy')
const crypto = require('crypto')
const NodeCache = require('node-cache')
const s3Client = require('./s3-client')

class Cache {
  constructor() {
    this._cache = new NodeCache({
      stdTTL: 60 * 60,
      useClones: false
    })

    this.set = this._cache.set.bind(this._cache)
    this.get = this._cache.get.bind(this._cache)
  }

  register(func, context) {
    return (function () {
      const cacheKey = crypto
        .createHash('md5')
        .update( `${func.name}:${JSON.stringify(arguments)}`, 'utf8')
        .digest('hex')

      const maybeResult = this._cache.get(cacheKey)

      if (maybeResult !== undefined) {
        console.log('cache hit')
        console.log(func.name)
        console.log(JSON.stringify(arguments, null, 2))
        return maybeResult
      } else {
        console.log('is similar cache miss')
        const result = func.call(context, ...arguments)
        this._cache.set(
          cacheKey,
          result
        )
        return result
      }
    }).bind(this)
  }
}

const cache = new Cache()
module.exports = cache
