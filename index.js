const cache = require('./cache')
const { asyncMapSerial } = require('./async-array-helpers')
const run = require('./run')

const subreddits = [
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
]

;(async function () {
  let plagiarismCases = []
  let authors = [
  ]

  try {
    while (true) {
      try {
        await asyncMapSerial(
          subreddits,
          async (subreddit) => {
            try {
              const remainder = await run({
                subreddit,
                plagiarismCases,
                authors,
                printTable: true
              })
              plagiarismCases = remainder.plagiarismCases
              authors = remainder.authors
            } catch (e) {
              console.error(`something went wrong:`)
              console.error(e)
            }
          }
        )
      } catch (e) {
        console.error(`something went wrong:`)
        console.error(e)
      }
    }
  } catch (e) {
    console.log('e', e)
  }

})()

;['beforeExit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'uncaughtException', 'SIGTERM'].forEach((eventType) => {
  process.on(eventType, () => {
    console.log('goodbye')
    cache.backupToFile()
    process.exit()
  })
})
