require('dotenv').config()
const fs = require('fs')
const api = require('./api')
const Data = require('./data')
const uniqBy = require('lodash/uniqBy')
const groupBy = require('lodash/groupBy')
const sortBy = require('lodash/sortBy')
const pickBy = require('lodash/pickBy')
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
const MAX_COMMENT_AGE = +process.env.MAX_COMMENT_AGE 

try {
  api.cache.data = JSON.parse(fs.readFileSync('./db/cache-backup.json'))
} catch (e) {}

const subreddits = [
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
]

const subredditsThatDisallowBots = [
  'americandad',
  'Watches',
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
  console.log('time: ', (new Date()).toLocaleTimeString())
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

  // ignore inactive authors
  const commentsPerAuthor = (await asyncMap(uniqBy(authors), api.getAuthorComments))
    .filter(authorComments => authorComments.length)
    .filter((authorComments) => {
      authorComments.sort((a, b) => b.created - a.created)
      const isActive = authorComments[0].created * 1000 > Date.now() - MAX_COMMENT_AGE
      if (!isActive) {
        console.log(`ignoring inactive author: ${authorComments[0].author.name}`)
      }
      return isActive
    })

  await asyncMap(
    Object.entries(groupBy(
      (commentsPerAuthor).flat(),
      'link_id'
    )),
    async ([postId, comments]) => {
      const post = data.getPost(postId) || await api.getPost(postId)
      if (post) {
        data.setPost({
          ...post,
          comments: uniqBy(
            [ ...post.comments, ...comments ],
            'id'
          )
        })
      }
    }
  )

  await asyncMap(
    data.getAllPosts(),
    async (post) => {
      const duplicatePostIds = await api.getDuplicatePostIds(post)
      console.log(`retrieving ${duplicatePostIds.length - 1} duplicate posts for post: ${post.id}`)
      data.setPost({
        ...post,
        duplicatePostIds,
      })
      await asyncMap(
        duplicatePostIds,
        async (dupeId) => {
          const dupe = data.getPost(dupeId) || await api.getPost(dupeId)
          if (dupe) {
            data.setPost({
              ...dupe,
              duplicatePostIds,
            })
          }
        }
      )
    }
  )

  console.log('num posts after dupe search: ', data.getAllPosts().length)
  const plagiarismCases = uniqBy([ ...initialPlagiarismCases, ...findPlagiarismCases(data.getAllPosts()) ], 'copy.id')
  console.log('plagiarismCases.length', plagiarismCases.length)

  const plagiarismCasesPerAuthor = Object.values(groupBy(plagiarismCases, 'author'))
    .map(authorPlagiarismCases => authorPlagiarismCases.map(plagiarismCase => ({
      ...plagiarismCase,
      additional: authorPlagiarismCases.filter(pc => pc!== plagiarismCase)
    })))
    
  if (printTable) {
    plagiarismCasesPerAuthor.forEach((authorPlagiarismCases) => {
      if (authorPlagiarismCases.length) {
        console.log('----------------------------------')
        console.log(authorPlagiarismCases[0].author)
        console.log(createTable(authorPlagiarismCases))
      }
    })
  }

  await asyncMap(
    plagiarismCasesPerAuthor
      .filter(authorPlagiarismCases => authorPlagiarismCases.length >= MIN_PLAGIARIST_CASES),
    async authorPlagiarismCases => asyncMap(
      await asyncFilter(authorPlagiarismCases, plagiarismCaseFilter),
      async (plagiarismCase) => {
        if (dryRun) return

        await api.reportComment(plagiarismCase.copy, createReportText(plagiarismCase))

        if (shouldReply(plagiarismCase)) {
          await api.replyToComment(plagiarismCase.copy, createReplyText(plagiarismCase))
          await new Promise((resolve, reject) => {
            setTimeout(async () => {
              if (!await api.isCommentAlreadyRepliedTo(plagiarismCase.copy)) {
                console.log(`reply not showing up: http://reddit.com${plagiarismCase.copy.permalink}`)
              }
              resolve()
            }, 1000 * 30)
          })
        }
      }
    )
  )

  // These plagiarism cases haven't had their author searched yet
  const remainderPlagiarismCases = plagiarismCases.filter(plagiarismCase => !authors.includes(plagiarismCase.author))

  // We will 
  const authorsToReturn = uniqBy(
    remainderPlagiarismCases
      .sort((a, b) => remainderPlagiarismCasesByAuthor[b.author].length - remainderPlagiarismCasesByAuthor[a.author].length
        || b.copy.created - a.copy.created
      )
      .map(plagiarismCase => plagiarismCase.author)
  ).slice(0, 20)

  const plagiarismCasesToReturn = authorsToReturn.map(author => remainderPlagiarismCasesByAuthor[author]).flat()

  return {
    plagiarismCases: plagiarismCasesToReturn,
    authors: authorsToReturn,
  }
}

function shouldReply (plagiarismCase) {
  return !subredditsThatDisallowBots.some(
    subreddit => subreddit.toLowerCase() === plagiarismCase.copy.subreddit.display_name.toLowerCase()
  )
}

async function printTables (plagiarismCasesPerAuthor) {
}

let dryRun
let printTable
printTable = true
// dryRun = true

;(async function () {

  try {
    let plagiarismCases = []
    let authors = []
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
                dryRun,
                printTable
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

  // await run({
  //   author: 'porkinfielder',
  //   dryRun,
  //   printTable
  // })

})()

module.exports = run

;['beforeExit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'uncaughtException', 'SIGTERM'].forEach((eventType) => {
  process.on(eventType, () => {
    console.log('goodbye')
    const cacheToSave = pickBy(
      api.cache.data,
      value => Object.prototype.toString.call(value.v) !== '[object Promise]'
    )
    fs.writeFileSync('./db/cache-backup.json', JSON.stringify(cacheToSave))
    process.exit()
  })
})
