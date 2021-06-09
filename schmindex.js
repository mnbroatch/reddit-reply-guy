const cache = require('./cache')
const { asyncMapSerial } = require('./async-array-helpers')
const run = require('./run')
const api = require('./api')

;(async function () {

  const { authors } = await run({
    // subreddit: 'Instagram',
    authors: [
      'connor_bedard',
    ],
    dryRun: true,
    printTable: true
  })
  console.log(JSON.stringify(authors, null, 2))

})()

;['beforeExit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'uncaughtException', 'SIGTERM'].forEach((eventType) => {
  process.on(eventType, () => {
    console.log('goodbye')
    cache.backupToFile()
    process.exit()
  })
})
