const getCache = require('./get-cache')
const run = require('./run')
const getApi = require('./get-api')
const getCredits = require('./get-credits')
const subreddits = require('./subreddits')
const { exec } = require('child_process');

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
      const credits = await getCredits()
      if (credits < 1) {
        exec('sudo shutdown now -h')
        return
      }
    }
    console.log('time: ', (new Date()).toLocaleTimeString())
    const start = Date.now()
    await search()
    console.log(`search took ${Date.now() - start}ms`)
    console.log('--------------------------------')
  }
})()
