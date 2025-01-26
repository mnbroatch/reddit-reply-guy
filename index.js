const getCache = require('./get-cache')
const run = require('./run')
const getApi = require('./get-api')
const getCredits = require('./get-credits')
const subreddits = require('./subreddits')

async function search () {
  const cache = await getCache()
  const api = await getApi()
  const savestate = await api.getSavestate()
  try {
    savestate.initialPlagiarismCases = await run(savestate)
    savestate.subreddit = subreddits[(subreddits.indexOf(savestate.subreddit) + 1) % subreddits.length]
    await api.writeSavestate(savestate)
    await api.backupDb()
    await cache.backup()
  } catch (e) {
    console.error(e)
  }
}

;(async function () {
  console.log('=====================================')
  while (true) {
    if (!process.env.IS_LOCAL) {
      let credits = await getCredits()
      if (credits < 10) {
        console.log('credits low, rebuilding')
        while (credits < 30) {
          await sleep(1000 * 60)
          credits = await getCredits()
        }
      }
    }
    console.log('time: ', (new Date()).toLocaleTimeString())
    const start = Date.now()
    await search()
    console.log(`search took ${Date.now() - start}ms`)
    console.log('--------------------------------')
  }
})()

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
