require('dotenv').config()
const fs = require('fs')
const api = require('./api')
const Data = require('./data')
const uniqBy = require('lodash/uniqBy')
const groupBy = require('lodash/groupBy')
const sortBy = require('lodash/sortBy')
const findPlagiarismCases = require('./find-plagiarism-cases')
const plagiarismCaseFilter = require('./plagiarism-case-filter')
const {
  createReplyText,
  createReportText,
  createTable
} = require('./create-summary-text')
const {
  asyncMap,
  asyncMapSerial,
  asyncFilter,
  asyncReduce,
  asyncFind,
} = require('./async-array-helpers')

const MIN_PLAGIARIST_CASES = +process.env.MIN_PLAGIARIST_CASES

try {
  api.cache.data = JSON.parse(fs.readFileSync('./db/cache-backup.json'))
} catch (e) {}

const subreddits = [
  'relationships',
  'politics',
  'leagueoflegends',
  'Tinder',
  'news',
  'me_irl',
  'WhitePeopleTwitter',
  'happycowgifs',
  'cats',
  'instant_regret',
  'science',
  'Music',
  'Genshin_Impact',
  'movies',
  'PoliticalHumor',
  'Art',
  'tumblr',
  'KidsAreFuckingStupid',
  'reverseanimalrescue',
  'dataisbeautiful',
  'nonononoyes',
  'OldSchoolCool',
  'ShowerThoughts',
  'aww',
  'DIY',
  'LifeProTips',
  'all',
  'popular',
  'AskReddit',
  'pcmasterrace',
  'videos',
  'gadgets',
  'mildlyinteresting',
  'pics',
  'gifs',
  'NatureIsFuckingLit',
  'funny',
  'memes',
  'gaming',
  'food',
  'todayilearned',
  'madlads',
  'tifu',
  'HistoryMemes',
  'Futurology',
  'nextfuckinglevel',
  'gardening',
  'forbiddensnacks',
  'Overwatch',
  'interestingasfuck',
]

const subredditsThatDisallowBots = [
  'funny',
  'Futurology',
  'Gaming',
  'Games',
  'WTF',
  'memes',
  'Jokes',
  'gifs',
  'books',
  'EarthPorn',
  'AskReddit',
  'holdmyredbull',
  'IAmA',
  'todayilearned',
  'sports',
  'politics',
  'Minecraft',
  'gratefuldead',
  'ich_iel',
  'FairyTaleAsFuck',
  'askscience',
  'texas',
  'Republican',
  'OldPhotosInRealLife',
  'cars',
  'sweden',
  'Israel',
  'Arkansas',
  'MakeMeSuffer',
  'barkour',
]

async function run ({
  dryRun,
  printTable,
  author,
  authors = author ? [ author ] : [],
  subreddit,
  subreddits = subreddit ? [ subreddit ] : [],
  postId,
  postIds = postId ? [ postId ] : [],
  initialPlagiarismCases = []
}) {
  const data = new Data()

  authors.length && console.log(`searching authors: ${authors}`)
  subreddits.length && console.log(`searching subreddits: ${subreddits}`)
  postIds.length && console.log(`searching postIds: ${postIds}`)

  ;(await asyncMap(postIds, api.getPost))
    .flat()
    .forEach(data.setPost)

  ;(await asyncMap(subreddits, api.getSubredditPosts))
    .flat()
    .forEach(data.setPost)

  await asyncMap(
    Object.entries(groupBy(
      (await asyncMap(authors, api.getAuthorComments)).flat(),
      'link_id'
    )),
    async ([postId, comments]) => {
      const post = data.getPost(postId) || await api.getPost(postId)
      data.setPost({
        ...post,
        comments: uniqBy(
          [ ...post.comments, ...comments ],
          'id'
        )
      })
    }
  )

  console.log('num posts before dupe search: ', data.getAllPosts().length)
  await asyncMap(
    data.getAllPosts(),
    async (post) => {
      const duplicatePostIds = await api.getDuplicatePostIds(post)
      console.log('duplicatePostIds', duplicatePostIds)
      data.setPost({
        ...post,
        duplicatePostIds,
      })
      await asyncMap(
        duplicatePostIds,
        async (dupeId) => {
          const dupe = data.getPost(dupeId) || await api.getPost(dupeId)
          data.setPost({
            ...dupe,
            duplicatePostIds,
          })
        }
      )
    }
  )

  console.log('num posts after dupe search: ', data.getAllPosts().length)
  const plagiarismCases = [ ...initialPlagiarismCases, ...findPlagiarismCases(data.getAllPosts()) ]
  console.log('plagiarismCases.length', plagiarismCases.length)

  const plagiarismCasesPerAuthor = Object.values(groupBy(plagiarismCases, 'author'))
    .map(authorPlagiarismCases => authorPlagiarismCases.map(plagiarismCase => ({
      ...plagiarismCase,
      additional: authorPlagiarismCases.filter(pc => pc!== plagiarismCase)
    })))
    
  if (printTable) {
    printTables(plagiarismCasesPerAuthor)
  }

  await asyncMap(
    plagiarismCasesPerAuthor
      .filter(authorPlagiarismCases => authorPlagiarismCases.length >= MIN_PLAGIARIST_CASES),
    async authorPlagiarismCases => asyncMap(
      await asyncFilter(authorPlagiarismCases, plagiarismCaseFilter),
      async (plagiarismCase) => {
        console.log(`http://reddit.com${plagiarismCase.copy.permalink}`)
        if (dryRun) return

        await api.reportComment(plagiarismCase.copy, createReportText(plagiarismCase))

        if (shouldReply(plagiarismCase)) {
          await api.replyToComment(plagiarismCase.copy, createReplyText(plagiarismCase))
          await new Promise((resolve, reject) => {
            setTimeout(async () => {
              if (!await api.isCommentAlreadyRepliedTo(plagiarismCase.copy)) {
                throw new Error()
              }
              resolve()
            }, 1000 * 30)
          })
        }
      }
    )
  )

  // These plagiarism cases haven't had their author searched yet
  return plagiarismCases
    .map(plagiarismCase => !authors.includes(plagiarismCase.author))
}

function shouldReply (plagiarismCase) {
  return !subredditsThatDisallowBots.some(
    subreddit => subreddit.toLowerCase() === plagiarismCase.copy.subreddit.display_name.toLowerCase()
  )
}

async function printTables (plagiarismCasesPerAuthor) {
  plagiarismCasesPerAuthor.forEach((authorPlagiarismCases) => {
    if (authorPlagiarismCases.length) {
      console.log('----------------------------------')
      console.log(authorPlagiarismCases[0].author)
      console.log(createTable(authorPlagiarismCases))
    }
  })
}

;(async function () {
  let dryRun
  let printTable
  printTable = true
  // dryRun = true

  // await run({
  //   postId: 'cgge03',
  //   dryRun,
  //   printTable
  // })
  
  let initialPlagiarismCases = []
  while (true) {
    try {
      await asyncMapSerial(
        subreddits,
        async (subreddit) => {
          try {

            initialPlagiarismCases = await run({
              subreddit,
              initialPlagiarismCases,
              dryRun,
              printTable
            })

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

})()

module.exports = run

;[`SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`].forEach((eventType) => {
  process.on(eventType, process.exit);
})

process.on('exit', () => {
  console.log('goodbye')
  fs.writeFileSync('./db/cache-backup.json', JSON.stringify(api.cache.data))
})
