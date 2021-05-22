require('dotenv').config()
const fs = require('fs')
const api = require('./api')
const cache = require('./cache')
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
  cache._cache.data = JSON.parse(fs.readFileSync('./db/cache-backup.json'))
} catch (e) {}

const subreddits = [
  'mildlyinteresting',
  'pics',
  'gifs',
  'NatureIsFuckingLit',
  'funny',
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
  'memes',
  'videos',
  'gadgets',
]

const subredditsThatDisallowBots = [
  'americandad',
  'Futurology',
  'WTF',
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

  const plagiarismCasesByAuthor = groupBy(plagiarismCases, 'author')
  const plagiarismCasesPerAuthor = Object.values(plagiarismCasesByAuthor)
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
    async authorPlagiarismCases => {
      if (dryRun) return

      let reply // will be overwritten each case, but we only need one per author
      let comment
      await asyncMap(
        await asyncFilter(authorPlagiarismCases, plagiarismCaseFilter),
        async (plagiarismCase) => {
          await api.reportComment(plagiarismCase.copy, createReportText(plagiarismCase))

          if (shouldReply(plagiarismCase)) {
            reply = await api.replyToComment(plagiarismCase.copy, createReplyText(plagiarismCase))
            comment = plagiarismCase.copy
          }
        }
      )

      if (
        reply
          && comment
          && authorPlagiarismCases.length > 4
          && !await api.getAuthorLastSearched(comment.author.name)
      ) {
        await api.reportAuthor(comment.author.name, `http://reddit.com/comments/${comment.link_id}//${reply.id}`)
      }
    }
  )

  if (!dryRun) {
    asyncMap(
      authors,
      api.setAuthorLastSearched
    )
  }

  // Carry over some of the cases whose authors we haven't investigated fully.
  // Only carry over least recently searched authors and cases.
  const remainderPlagiarismCasesPerAuthor = plagiarismCasesPerAuthor
    .filter(authorPlagiarismCases => !authors.includes(authorPlagiarismCases[0].author))

  const remainderAuthorsLastSearched = await asyncMap(
    remainderPlagiarismCasesPerAuthor,
    async authorPlagiarismCases => ({
      author: authorPlagiarismCases[0].author,
      lastSearched: await api.getAuthorLastSearched(authorPlagiarismCases[0].author),
      latestCommentCreated: authorPlagiarismCases.sort((a, b) => b.copy.created - a.copy.created)[0].copy.created,
      plagiarismCasesCount: authorPlagiarismCases.length
    })
  )

  console.log('remainderAuthorsLastSearched', remainderAuthorsLastSearched)

  const authorsToReturn = uniqBy(
    remainderAuthorsLastSearched
      .sort((a, b) => 
        (a.lastSearched || 0) - (b.lastSearched || 0)
          || b.plagiarismCasesCount - a.plagiarismCasesCount
          || b.latestCommentCreated - b.latestCommentCreated
      )
      .map(plagiarismCase => plagiarismCase.author)
  ).slice(0, 20)

  const plagiarismCasesToReturn = authorsToReturn.map(author => plagiarismCasesByAuthor[author]).flat()

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

  let plagiarismCases = []
  let authors = []

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
  //   author: 'Sploosh89',
  //   dryRun,
  //   printTable
  // })

})()

module.exports = run

;['beforeExit', 'SIGINT', 'SIGUSR1', 'SIGUSR2', 'uncaughtException', 'SIGTERM'].forEach((eventType) => {
  process.on(eventType, () => {
    console.log('goodbye')
    const cacheToSave = pickBy(
      cache._cache.data,
      value => Object.prototype.toString.call(value.v) !== '[object Promise]'
    )
    fs.writeFileSync('./db/cache-backup.json', JSON.stringify(cacheToSave))
    process.exit()
  })
})
