require('dotenv').config()
const Snoowrap = require('snoowrap')
const uniqBy = require('lodash/uniqBy')
const flatMap = require('lodash/flatMap')
const groupBy = require('lodash/groupBy')
const {
  findCommentPairsInPost,
  isSimilar
} = require('./find-comment-pairs')
const {
  createReplyText,
  createReportText,
  createTable
} = require('./create-summary-text')
const {
  asyncMap,
  asyncMapSerial,
  asyncFilter,
  asyncNot,
  asyncReduce,
  asyncFind,
} = require('./async-array-helpers')
const {
  isCommentFubar,
  isPostFubar,
  getAuthorCooldown,
  addCommentToFubarList,
  addPostToFubarList,
  addOrUpdateAuthorCooldown,
  cleanup,
} = require('./db')

const snoowrap = new Snoowrap({
  userAgent: 'reply-guy-bot',
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  username: process.env.REDDIT_USER,
  password: process.env.REDDIT_PASS
})
snoowrap.config({ continueAfterRatelimitError: true })

const EXAMPLE_THREAD_ID = 'mnrn3b'
const MEGATHREAD_ID = 'mqlaoo'
const BOT_USER_ID = 't2_8z58zoqn'
const INITIAL_POST_LIMIT = 15
const AUTHOR_POST_LIMIT = 30
const AUTHORS_CHUNK_SIZE = 5
const MIN_PLAGIARIST_CASES = 3

const subredditsThatDisallowBots = [
  'WTF',
  'memes',
  'Jokes',
  'gifs',
  'books',
  'EarthPorn',
  'AskReddit',
  'SteamGameSwap',
  'SteamTradingCards',
  'mushroomkingdom',
  'SchlockMercenary',
  'SGS',
  'bans',
  'sgsappeals',
  'SGScirclejerk',
  'Steamworks',
  'FlairLinkerEnhanced',
  'RUGCTrade',
  'holdmyredbull',
  'IAmA',
  'todayilearned',
  'sports',
]

// Some posts simply won't return /u/reply-guy-bot comments for seemingly no reason.
// If duplicate bot replies are noticed, comment should go here -_-
const fubarCommentIds = []

async function run ({
  subreddit,
  authors,
  logTable,
  dryRun,
}) {
  console.log('===========================================')
  if (subreddit) {
    console.log(`searching in /r/${subreddit}`)
  } else {
    console.log(`searching ${authors?.length || 0} authors`)
  }

  // Filter is only an optimization, these authors' comments
  // could still be detected in others' retrieved posts.
  authors = await asyncFilter(
    authors || await getPlagiaristsFromPosts(await getInitialPosts(subreddit)),
    asyncNot(isAuthorOnCooldown)
  )

  console.log(`investigating ${authors.length} suspected plagiarists:`)
  authors.forEach((author) => { console.log(author) })

  const comments = uniqBy(
    await asyncFilter(
      (await asyncMap(
        authors,
        getCommentsFromAuthor
      )).flat(),
      asyncNot(isCommentFubar)
    ),
    'id'
  )

  const posts = uniqBy(
    await asyncFilter(
      await asyncMap(
        comments,
        getPostFromComment,
      ),
      asyncNot(isPostFubar)
    ),
    'id'
  )

  const commentPairsPerAuthor = Object.values(
    groupBy(
      uniqBy(
        (await asyncMap(
          posts,
          findCommentPairsInPost
        )).flat(),
        'copy.id'
      ),
      'copy.author.name'
    )
  ).filter(authorCommentPairs => {
    const isRepetitive = isAuthorRepetitive(authorCommentPairs)
    if (isRepetitive) {
      console.log(`found a repetitive author: ${authorCommentPairs[0].copy.author.name}`)
    }
    return !isRepetitive
  })
  // Filtering here is kinda ugly, let's hopefully improve one day.

  // We will return newly-found, investigation-pending authors.
  const {
    commentPairsPerPendingAuthor = [],
    commentPairsPerInvestigatedAuthor = []
  } = groupBy(
    commentPairsPerAuthor,
    authorCommentPairs => 
      authors.some(author => author === authorCommentPairs[0].copy.author.name)
        ? 'commentPairsPerInvestigatedAuthor'
        : 'commentPairsPerPendingAuthor'
  )

  const {
    sufficientCommentPairsPerAuthor = [],
    insufficientCommentPairsPerAuthor = []
  } = groupBy(
    commentPairsPerInvestigatedAuthor,
    authorCommentPairs => authorCommentPairs.length >= MIN_PLAGIARIST_CASES
      ? 'sufficientCommentPairsPerAuthor'
      : 'insufficientCommentPairsPerAuthor'
  )

  const sufficientCommentPairsByStatusPerAuthor = await asyncMap(
    sufficientCommentPairsPerAuthor,
    groupCommentPairsByStatus
  )

  const processingResultsPerAuthor = (await asyncMap(
    sufficientCommentPairsByStatusPerAuthor,
    async authorCommentPairsByStatus => groupBy(
      await asyncMap(
        authorCommentPairsByStatus.viable,
        async (commentPair) => processCommentPair(commentPair, authorCommentPairs, dryRun)
      ),
      'status'
    )
  ))

  if (insufficientCommentPairsPerAuthor.length) {
    console.log('-------------------------------')
    console.log(`${insufficientCommentPairsPerAuthor.length} authors with insufficient plagiarism counts:`)
    insufficientCommentPairsPerAuthor.map(authorCommentPairs => authorCommentPairs[0].copy.author.name)
      .forEach((author) => { console.log(author) })
    console.log('-------------------------------')
  }

  sufficientCommentPairsByStatusPerAuthor.forEach(
    (commentPairsByStatus) => {
      const author = Object.values(commentPairsByStatus)[0][0].copy.author.name
      console.log('-------------------------------')
      console.log(`${author}: `)
      Object.entries(commentPairsByStatus).forEach(([status, authorCommentPairs]) => {
        if (status === 'viable') {
          console.log(`${authorCommentPairs.length} processed: ${status}`)
          const authorResults = processingResultsPerAuthor.find(
            authorProcessingResults => authorProcessingResults[0].author === author
          )
          Object.entries(authorResults).forEach(([status, results]) => {
            console.log(`${results.length} cases processed with status: ${status}`)
          })
        } else {
          console.log(`${authorCommentPairs.length} cases not processed for reason: ${status}`)
        }
      })
      console.log('-------------------------------')
    }
  )

  console.log('===========================================')

  await asyncMap( 
    commentPairsPerInvestigatedAuthor,
    authorCommentPairs => updateAuthorCooldown(authorCommentPairs[0].copy.author.name, authorCommentPairs.length)
  )

  // return authors we found along the way but didn't audit, so we can investigate further
  return commentPairsPerPendingAuthor.map(authorCommentPairs => authorCommentPairs[0].copy.author.name)
}

async function groupCommentPairsByStatus(commentPairs) {
  const criteria = [
    {
      reason: 'tooOld',
      test: asyncNot(isCommentTooOld),
    },
    {
      reason: 'broken',
      test: asyncNot(isCommentFubar),
    },
    {
      reason: 'alreadyResponded',
      test: asyncNot(isAlreadyRespondedTo),
    },
  ]

  return asyncReduce(
    commentPairs,
    async (acc, commentPair) => {
      let key 
      try {
        key = (await asyncFind(
          criteria,
          (criterion) => criterion.test(commentPair.copy)
        )).reason || 'viable'
      } catch (e) {
        console.error(e)
        key = 'broken'
        await addCommentToFubarList(commentPair.copy)
      }
      return { ...acc, [key]: [ ...(acc[key] || []), commentPair ] }
    }, {}
  )
}

// The idea here is that a copy bot will not always post the same thing.
// Inspired by some commenters that only ever post "sorry for your loss"
// Half might be too generous, especially if bots catch on.
function isAuthorRepetitive(authorCommentPairs) {
  return authorCommentPairs.reduce((acc, commentPair) => {
    const numSimilar = authorCommentPairs
      .filter(c => c !== commentPair && isSimilar(c.copy.body, commentPair.copy.body))
      .length
    return numSimilar > acc ? numSimilar : acc
  }, 0) > authorCommentPairs.length / 2
}

async function getInitialPosts(subreddit) {
  let posts = []
  try {
    posts = await snoowrap.getHot(subreddit, {limit: INITIAL_POST_LIMIT})
      .map(post => getPost(post.id))
  } catch (e) {
    console.error(`Could not get posts from ${subreddit}: `, e.message)
  }
  return posts
}

async function getPost (postId) {
  try {
    const post = await snoowrap.getSubmission(postId)
    return {
      id: await post.id,
      comments: flattenReplies(await post.comments)
    }
  } catch (e) {
    console.error(`couldn't get post: ${postId}`)
    await addPostToFubarList(postId)
  }
}

// TODO: remove nested reply structure
function flattenReplies(comments) {
  return comments.reduce((acc, comment) => {
    if (!comment.replies.length) {
      return [ ...acc, comment ]
    } else {
      return [ ...acc, comment, ...flattenReplies(comment.replies) ]
    }
  }, [])
}

async function getCommentsFromAuthor(author) {
  try {
    return snoowrap.getUser(author).getComments({ limit: AUTHOR_POST_LIMIT })
  } catch (e) {
    console.error(`couldn't get author comments: http://reddit.com/u/${author}`)
    await updateAuthorCooldown(author)
    return []
  }
}

async function getPostFromComment(comment) {
  const post = await getPost(comment.link_id)
  // include starting comment in case we didn't receive it
  return !post.comments.some(c => c.id === comment.id)
    ? { ...post, comments: [ ...post.comments, comment ] }
    : post
}

function postReply(comment, message) {
  return comment.reply(message)
    .catch(async (e) => {
      console.error(`couldn't post reply to: http://reddit.com${comment.permalink}`)
      await addCommentToFubarList(comment)
      return null
    })
}

function sendReport(comment, message) {
  return comment.report({ reason: message })
    .catch(async (e) => {
      console.error(`Couldn't report comment: http://reddit.com${comment.permalink}`)
      await addCommentToFubarList(comment)
      return null
    })
}

async function processCommentPair (commentPair, authorCommentPairs, dryRun) {
  const additionalCases = authorCommentPairs.filter(c => commentPair !== c)
  const shouldReply = !subredditsThatDisallowBots
    .some(subreddit => subreddit.toLowerCase() === commentPair.copy.subreddit.display_name.toLowerCase())

  const [postResponse] = await Promise.allSettled([
    !dryRun && shouldReply && postReply(
      commentPair.copy,
      createReplyText(commentPair, additionalCases)
    ),
    !dryRun && sendReport(
      commentPair.copy,
      createReportText(commentPair)
    ),
  ])

  // wait some time and see if our comments are included.
  let hasBotReply = false
  if (shouldReply && postResponse.value) {
    await new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          hasBotReply = await isAlreadyRespondedTo(commentPair.copy)
        } catch (e) {
          console.error(e.message)
        }
        resolve()
      }, 1000 * 30)
    })

    if (!hasBotReply) {
      console.error(`bot reply not retrieved on: http://reddit.com${commentPair.copy.permalink}`)
      await addCommentToFubarList(commentPair.copy)
    } 
  }

  let status
  if (!shouldReply) {
    status = 'dryRun'
  } else if (!shouldReply) {
    status = 'reportOnly'
  } else if (!hasBotReply) {
    status = 'broken'
  } else {
    status = 'success'
  } 

  return {
    id: commentPair.copy.id,
    author: commentPair.copy.author.name,
    status
  }
}

async function isAlreadyRespondedTo(comment) {
  const replies = comment.replies.length
    ? comment.replies
    : (await comment.expandReplies({ depth: 1 })).replies
  return replies.some(reply => reply.author_fullname === BOT_USER_ID)
}

async function getPlagiaristsFromPosts(posts) {
  return uniqBy(
    (await asyncMap(posts, findCommentPairsInPost)).flat(),
    'copy.author.name'
  ).map(commentPair => commentPair.copy.author.name)
}

async function updateAuthorCooldown(name, copyCount = 0) {
  const maybeAuthor = await getAuthorCooldown(name)
  const now = Date.now()

  // cooldown doubles up to 1 day unless new cases are found.
  let cooldownEnd
  if (
    copyCount > MIN_PLAGIARIST_CASES
    && copyCount !== maybeAuthor?.copyCount // not stale, count has changed
  ) {
    cooldownEnd = now
  } else {
    cooldownEnd = maybeAuthor
      ? now + Math.min((now - author.cooldownStart) * 2, 1000 * 60 * 60 * 24)
      : now + 1000 * 60 * 60
  }

  return addOrUpdateAuthorCooldown(
    name,
    now,
    cooldownEnd,
    copyCount
  )
}

function isCommentTooOld({ created }) {
  return created < Date.now() / 1000 - 60 * 60 * 24 * 3
}

async function isAuthorOnCooldown (author) {
  return (await getAuthorCooldown(author))?.cooldownEnd > Date.now()
}

const subreddits = [
  'cursedcomments',
  'gifs',
  'worldnews',
  'NatureIsFuckingLit',
  'funny',
  'gaming',
  'food',
  'CODWarzone',
  'todayilearned',
  'OutOfTheLoop',
  'iamatotalpieceofshit',
  'BrandNewSentence',
  'aww',
  'memes',
  'madlads',
  'tifu',
  'HistoryMemes',
  'gadgets',
  'OldSchoolCool',
  'Futurology',
  'nextfuckinglevel',
  'science',
  'gardening',
  'forbiddensnacks',
  'Overwatch',
  'interestingasfuck',
  'relationships',
  'politics',
  'instant_regret',
  'leagueoflegends',
  'Tinder',
  'news',
  'cats',
  'Music',
  'Genshin_Impact',
  'movies',
  'Art',
  'blog',
  'europe',
  'books',
  'all',
  'popular',
  'fedex',
  'AskReddit',
  'nottheonion',
  'IAmA',
  'pcmasterrace',
  'videos',
  'AnimalsBeingBros',
  'funnyvideos',
  'mildlyinteresting',
  'pics',
  'antiMLM',
  'explainlikeimfive',
  'StarWars',
]

;(async function () {
  const dryRun = true
  while (true) {
    try {
      await asyncMapSerial(
        subreddits,
        async (subreddit) => {
          try {
            const authors = await run({ subreddit, dryRun })
            if (authors.length) {
              await run({ authors, dryRun })
            }
          } catch (e) {
            console.error(`something went wrong:`)
            console.error(e)
          }
        }
      )
      await cleanup()
    } catch (e) {
      console.error(`something went wrong:`)
      console.error(e)
    }
  }
})()

// run({
//   authors: [
//     'security123enjoy'
//   ],
//   dryRun: true,
//   // logTable: true,
// })

module.exports = run
