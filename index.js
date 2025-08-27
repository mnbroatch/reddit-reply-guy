const getCache = require('./get-cache')
const run = require('./run')
const { MIN_CREDITS, MIN_CREDITS_FOR_START } = require('./constants')
const getApi = require('./get-api')
const getCredits = require('./get-credits')
const subreddits = require('./subreddits')
const { exec } = require('child_process');

async function search () {
  const cache = await getCache()
  const api = await getApi()
  const savestate = await api.getSavestate()
  try {
    if (!savestate.subreddit) {
      savestate.subreddit = subreddits[0]
    }
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
  let credits
  if (!process.env.IS_LOCAL) {
    credits = await getCredits()
    // This means we started but amazon didn't give us our creds
    while (credits < MIN_CREDITS_FOR_START) {
      console.log('low credits at startup, waiting: ', credits)
      await sleep(1000 * 60)
      credits = await getCredits()
    }
  }
  while (true) {
    if (!process.env.IS_LOCAL) {
      credits = await getCredits()
	console.log('memory: ', process.memoryUsage())
      if (credits < MIN_CREDITS) {
        console.log('low credits, shutting down:', credits)
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
