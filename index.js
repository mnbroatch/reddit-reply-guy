const cache = require('./cache')
const run = require('./run')
const getApi = require('./get-api')
const subreddits = require('./subreddits')

const DRY_RUN = false

let api
let savestate
async function search () {
  if (!api) {
    api = await getApi()
  }
  if (!savestate) {
    savestate = await api.getSavestate()
  }
  try {
    const remainder = await run(savestate)
    savestate.plagiarismCases = remainder.plagiarismCases
    savestate.authors = remainder.authors
    savestate.subreddit = subreddits[(subreddits.indexOf(savestate.subreddit) + 1) % subreddits.length]
    await api.writeSavestate(savestate)
    await cache.backup()
  } catch (e) {
    console.error(e)
  }
}

;(async function () {
  // while (true) {
    console.log('time: ', (new Date()).toLocaleTimeString())
    const start = Date.now()
    await search()
    console.log(`search took ${Date.now() - start}ms`)
  // }
})()

