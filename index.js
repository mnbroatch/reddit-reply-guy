const fs = require('fs')
const cache = require('./cache')
const { asyncMapSerial } = require('./async-array-helpers')
const run = require('./run')
const pickBy = require('lodash/pickBy')

const subreddits = [
  'Amd',
  'GlobalOffensive',
  'technology',
  'MurderedByWords',
  'Twitch',
  'WhitePeopleTwitter',
  'whatisthisthing',
  'DestinyTheGame',
  'AskMen',
  'NintendoSwitch',
  'TheLastAirbender',
  'NBA2k',
  'natureismetal',
  'DnD',
  'pathofexile',
  'WinStupidPrizes',
  'Jokes',
  'sex',
  'xboxone',
  'CODWarzone',
  '2007scape',
  'Hololive',
  'TwoXChromosomes',
  'IdiotsInCars',
  'mildlyinteresting',
  'LifeProTips',
  'techsupport',
  'OnePiece',
  'AskHistorians',
  'iamverybadass',
  'coolguides',
  'Tinder',
  'askscience',
  'PSO2',
  'classicwow',
  'oddlysatisfying',
  'AskWomen',
  'Unexpected',
  'VALORANT',
  'IAmA',
  'relationships',
  'manga',
  'dataisbeautiful',
  'apple',
  'insanepeoplefacebook',
  'sysadmin',
  'trashy',
  'dndnext',
  'apexlegends',
  'pokemon',
  'books',
  'facepalm',
  'Cringetopia',
  'barstoolsports',
  'cringe',
  'FortNiteBR',
  'totalwar',
  'Whatcouldgowrong',
  'fo76',
  'MovieDetails',
  'Instagram',
  'MechanicalKeyboards',
  'witcher',
  'teenagers',
  'europe',
  'PoliticalCompassMemes',
  'AskReddit',
  'pics',
  'politics',
  'news',
  'ksi',
  'worldnews',
  'funny',
  'tifu',
  'videos',
  'gaming',
  'aww',
  'todayilearned',
  'gifs',
  'Minecraft',
  'memes',
  'Art',
  'JusticeServed',
  'movies',
  'XboxSeriesX',
  'wallstreetbets',
  'Home',
  'PublicFreakout',
  'NoStupidQuestions',
  'nextfuckinglevel',
  'leagueoflegends',
  'interestingasfuck',
  'relationship_advice',
  'modernwarfare',
  'AnimalCrossing',
  'gtaonline',
  'WatchPeopleDieInside',
  'explainlikeimfive',
  'wow',
  'PS4',
  'buildapc',
  'LivestreamFail',
  'Coronavirus',
  'unpopularopinion',
  'jailbreak',
  'BlackPeopleTwitter',
  'personalfinance',
  'me_irl',
  'WTF',
  'iamatotalpieceofshit',
  'OutOfTheLoop',
  'legaladvice',
  'ThatsInsane',
  'Bad_Cop_No_Donut',
  'Terraria',
  'cringepics',
  'EscapefromTarkov',
  'AmItheAsshole',
  'discordapp',
  'pcmasterrace',
  'anime',
  'ffxiv',
  'DotA2',
  'MadeMeSmile',
  'Wellthatsucks',
]

let savestate
try {
  savestate = JSON.parse(fs.readFileSync('./db/savestate.json'))
  savestate.authors = savestate.authors
    .concat([ // sneak in more authors here on startup
   ])
} catch (e) {
  savestate = {
    subreddit: subreddits[0],
    authors: [],
    plagiarismCases: [],
  }
}

async function search () {
  try {
    const remainder = await run({
      printTable: true,
      ...savestate
    })
    savestate.plagiarismCases = remainder.plagiarismCases
    savestate.authors = remainder.authors
    savestate.subreddit = subreddits[(subreddits.indexOf(savestate.subreddit) + 1) % subreddits.length]
  } catch (e) {
    console.error(`something went wrong:`)
    console.error(e)
  }
}

// investigating weird hangs
let timeout = 0
;(async function () {
  while (true) {
    const start = Date.now()
    timeout = setTimeout(() => {
      console.log('timeout')
      console.log('savestate: ', savestate)
      const pendingpromises = pickBy(
        cache._cache.data,
        value => Object.prototype.toString.call(value.v) === '[object Promise]'
      )
      console.log('pendingpromises', pendingpromises)
    }, 1000 * 60 * 60)
    await search()
    clearTimeout(timeout)
    console.log('Date.now() - start', Date.now() - start)
  }
})()

;['beforeExit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'uncaughtException', 'SIGTERM'].forEach((eventType) => {
  process.on(eventType, () => {
    console.log('goodbye')
    cache.backupToFile()
    fs.writeFileSync( './db/savestate.json', JSON.stringify(savestate))
    process.exit()
  })
})
