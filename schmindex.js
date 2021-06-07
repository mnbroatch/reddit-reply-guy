const { asyncMapSerial } = require('./async-array-helpers')
const run = require('./run')
const api = require('./api')

;(async function () {

  const { authors } = await run({
    postId: 'ntzlpt',
    authors: [],
    // dryRun: true,
    printTable: true
  })
  console.log(JSON.stringify(authors, null, 2))

})()
