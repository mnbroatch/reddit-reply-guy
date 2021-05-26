const { asyncMapSerial } = require('./async-array-helpers')
const run = require('./run')

;(async function () {
  await run({
    author: 'oska77rs',
    dryRun: true,
    printTable: true
  })
})()
