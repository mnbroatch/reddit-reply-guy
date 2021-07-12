const cache = require('./cache')
const { asyncMapSerial } = require('./async-array-helpers')
const run = require('./run')
const api = require('./api')
const stripComment = require('./strip-comment')

const {
  createReportText,
} = require('./create-summary-text')

;(async function () {

  const { authors } = await run({
    // postId: 'nyhjap',
    // subreddit: 'Instagram',
    authors: [
      'Afraid_Newspaper_979',
      'RevolutionaryToe1626',
      'BrianCrowley',
      'EarlMGoodman',
      'EricLOlson',
      'ErnestEAquilar',
      'GwendolynKirkley',
      'IvetteCramer',
      'JerryJWhiting',
      'JerrySMuncy',
      'LauraRHarrison',
      'MandyQuinn',
      'MelindaCHernandez',
      'MichaelARevis',
      'PerryMWilson',
      'ScottClements',
      'worried_ad4262',
    ],
    // dryRun: true,
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
