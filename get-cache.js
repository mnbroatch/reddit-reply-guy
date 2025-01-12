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

  async initialize () {
    try {
      if (process.env.IS_LOCAL) {
        this._cache.data = JSON.parse(fs.readFileSync('./db/cache-backup.json'))
      } else {
        const response = await s3Client.send(
          new GetObjectCommand({
            Bucket: 'redditreplyguy',
            Key: 'cachebackup',
          }),
        );
        this._cache.data = JSON.parse(await response.Body.transformToString());
      }
    } catch (e) {
    }
  }

  //  cache promises to handle duplicate requests.
  //  replace promise with actual value for serialization
  register(func, context) {
    return (async function () {
      const cacheKey = crypto
        .createHash('md5')
        .update( `${func.name}:${JSON.stringify(arguments)}`, 'utf8')
        .digest('hex')

      const maybeResult = await this._cache.get(cacheKey)

      if (maybeResult) {
        return maybeResult
      } else {
        const resultPromise = func.call(context, ...arguments)
        resultPromise.args = JSON.stringify(arguments, null, 2) // just for troubleshooting stalled promise, temp
        resultPromise.func = func // just for troubleshooting stalled promise, temp
        this._cache.set(
          cacheKey,
          resultPromise
        )

        this._cache.set(
          cacheKey,
          await resultPromise
        )

        return resultPromise
      }
    }).bind(this)
  }

  backup () {
    const cacheToSave = pickBy(
      cache._cache.data,
      value => Object.prototype.toString.call(value.v) !== '[object Promise]'
    )
    if (process.env.IS_LOCAL) {
      fs.writeFileSync('./db/cache-backup.json', JSON.stringify(cacheToSave))
    } else {
      const command = new PutObjectCommand({
        Bucket: 'redditreplyguy',
        Key: 'cachebackup',
        Body: JSON.stringify(cacheToSave),
      });
      return s3Client.send(command);
    }
  }
}

let cache
async function getCache () {
  if (!cache) {
    cache = new Cache()
    await cache.initialize()
  }
  return cache
}

module.exports = getCache
