const cache = require('./cache')
const run = require('./run')
const getApi = require('./get-api')

const DRY_RUN = false

const subreddits = [
  'aww',
  'Music',
  'memes',
  'movies',
  'Showerthoughts',
  'science',
  'pics',
  'Jokes',
  'news',
  'space',
  'videos',
  'DIY',
  'askscience',
  'books',
  'nottheonion',
  'mildlyinteresting',
  'food',
  'EarthPorn',
  'GetMotivated',
  'explainlikeimfive',
  'gadgets',
  'LifeProTips',
  'IAmA',
  'Art',
  'sports',
  'gifs',
  'dataisbeautiful',
  'Futurology',
  'Documentaries',
  'personalfinance',
  'photoshopbattles',
  'UpliftingNews',
  'Damnthatsinteresting',
  'WritingPrompts',
  'OldSchoolCool',
  'tifu',
  'history',
  'philosophy',
  'nosleep',
  'wholesomememes',
  'listentothis',
  'technology',
  'television',
  'wallstreetbets',
  'InternetIsBeautiful',
  'NatureIsFuckingLit',
  'relationship_advice',
  'creepy',
  'nba',
  'lifehacks',
  'pcmasterrace',
  'interestingasfuck',
  'ContagiousLaughter',
  'travel',
  'HistoryMemes',
  'Fitness',
  'anime',
  'dadjokes',
  'oddlysatisfying',
  'nfl',
  'Unexpected',
  'NetflixBestOf',
  'EatCheapAndHealthy',
  'MadeMeSmile',
  'AdviceAnimals',
  'tattoos',
  'CryptoCurrency',
  'mildlyinfuriating',
  'politics',
  'ChatGPT',
  'BeAmazed',
  'FoodPorn',
  'AnimalsBeingDerps',
  'facepalm',
  'europe',
  'soccer',
  'Minecraft',
  'Parenting',
  'leagueoflegends',
  'PS5',
  'rarepuppers',
  'WatchPeopleDieInside',
  'FunnyAnimals',
  'buildapc',
  'NintendoSwitch',
  'cats',
  'gardening',
  'Bitcoin',
  'itookapicture',
  'cars',
  'AnimalsBeingBros',
  'CozyPlaces',
  'programming',
  'MakeupAddiction',
  'HumansBeingBros',
  'AnimalsBeingJerks',
  'starterpacks',
  'Frugal',
  'malefashionadvice',
  'socialskills',
  'apple',
  'Overwatch',
  'nevertellmetheodds',
  'Awwducational',
  'Tinder',
  'dating',
  'coolguides',
  'woodworking',
  'entertainment',
  'nutrition',
  'CrappyDesign',
  'foodhacks',
  'femalefashionadvice',
  'nasa',
  'PS4',
  'drawing',
  'photography',
  'technicallythetruth',
  'YouShouldKnow',
  'FortNiteBR',
  'MealPrepSunday',
  'bestof',
  'TravelHacks',
  'ModernWarfareII',
  'anime_irl',
  'Sneakers',
  'NoStupidQuestions',
  'MapPorn',
  'backpacking',
  'boardgames',
  'pokemongo',
  'battlestations',
  'biology',
  'Economics',
  'trippinthroughtime',
  'Outdoors',
  'Shoestring',
  'OnePiece',
  'streetwear',
  'Survival',
  'camping',
  'PremierLeague',
  'strength_training',
  'formula1',
  'funny',
  'AskReddit',
  'gaming',
  'worldnews',
  'todayilearned',
]

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

