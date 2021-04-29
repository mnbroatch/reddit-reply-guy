require('dotenv').config()
const Snoowrap = require('snoowrap')
const uniqBy = require('lodash/uniqBy')
const flatMap = require('lodash/flatMap')
const groupBy = require('lodash/groupBy')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const { findCommentPairs, isSimilar } = require('./find-comment-pairs')
const { createReplyText, createReportText, createTable } = require('./create-summary-text')
const { asyncMap, asyncMapSerial, asyncFilter, asyncNot, asyncReduce } = require('./async-array-helpers')

const adapter = new FileSync('db/db.json')
const db = low(adapter)

db
  .defaults({
    fubarComments: [],
    fubarPosts: [],
    authorCooldowns: [],
  })
  .write()

const snoowrap = new Snoowrap({
  userAgent: 'reply-guy-bot',
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  username: process.env.REDDIT_USER,
  password: process.env.REDDIT_PASS
})
// snoowrap.config({ requestDelay: 100, continueAfterRatelimitError: true, warnings: false })
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
  authors.forEach((author) => console.log(author))

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

  console.log('posts.length', posts.length)

  const commentPairs = uniqBy(
    await asyncFilter(
      (await asyncMap(
        posts,
        findCommentPairs
      )).flat(),
      async commentPair => !await isCommentFubar(commentPair.copy)
    ),
    'copy.id'
  )

  const commentPairsPerAuthor = Object.values(
    groupBy(
      commentPairs,
      'copy.author.name'
    )
  ).filter(authorCommentPairs => !isAuthorRepetitive(authorCommentPairs)) // maybe bulk this code up if more author-level checks are needed

  console.log(`${commentPairsPerAuthor.flat().length} total cases found`)

  const { pendingTrial = [], guilty = [], innocent = [] } = groupBy(
    commentPairsPerAuthor,
    (authorCommentPairs) => {
      let key
      let value = authorCommentPairs
      if (!authors.some(author => author === authorCommentPairs[0].copy.author.name)) {
        return 'pendingTrial'
      } else if (authorCommentPairs.length >= MIN_PLAGIARIST_CASES){
        return 'guilty'
      } else {
        return 'innocent'
      }
    }
  )

  await asyncMap( 
    innocent,
    authorCommentPairs => updateAuthorCooldown(authorCommentPairs[0].copy.author.name)
  )

  await asyncMap( 
    guilty,
    authorCommentPairs => updateAuthorCooldown(authorCommentPairs[0].copy.author.name, authorCommentPairs.length)
  )

  console.log(`processing ${guilty.flat().length} cases`)

  const processingResults = await asyncMap(
    guilty,
    async authorCommentPairs => await asyncMap(
      await asyncFilter(
        authorCommentPairs,
        shouldProcessCommentPair
      ),
      commentPair => processCommentPair(commentPair, authorCommentPairs)
    )
  )

  commentPairsPerAuthor.forEach((authorCommentPairs) => {
    const author = authorCommentPairs[0].copy.author.name

    console.log('-------------------------------------')
    console.log('author', author)

    if (innocent.some((innocentAuthorCommentPairs) => innocentAuthorCommentPairs[0].copy.author.name === author)) {
      console.log(`found innocent with ${authorCommentPairs.length} cases`)
    } else if (pendingTrial.some((pendingTrialAuthorCommentPairs) => pendingTrialAuthorCommentPairs[0].copy.author.name === author)) {
      console.log(`will be searched later`)
    } else {
      processingResults.find(results => results[0].author.name === author)
        .forEach((authorResults) => {
        const { skipped, broken, success } = groupBy(
          authorResults,
          result => {
            if (!result.shouldReply) {
              return 'skipped'
            } else if (result.shouldReply && !result.hasBotReply) {
              return 'broken'
            } else {
              return 'success'
            }
          }
        )
        console.log(`had ${authorCommentPairs.length} processed cases:`)
        console.log(`${success?.length || 0} suceeded`)
        console.log(`${skipped?.length || 0} skipped`)
        console.log(`${broken?.length || 0} broken`)
      })
    } 

    if (logTable)  {
      guilty.forEach((authorCommentPairs) => {
        console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~')
        console.log(createTable(authorCommentPairs))
        console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~')
      })
    }

    console.log('-------------------------------------')
  })
  console.log('===========================================')

  // return authors we found along the way but didn't audit, so we can investigate further
  return pendingTrial.map(authorCommentPairs => authorCommentPairs[0].copy.author.name)
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

async function shouldProcessCommentPair (commentPair) {
  let alreadyResponded = false
  let isFubar = false
  try {
    alreadyResponded = await isAlreadyRespondedTo(commentPair.copy)
  } catch (e) {
    console.error(`couldn't get comment: http://reddit.com${commentPair.copy.permalink}`)
    isFubar = true
    await addCommentToFubarList(comment)
  }

  return !alreadyResponded
    && !isFubar
    && !isCommentTooOld(commentPair.copy)
}

async function processCommentPair (commentPair, authorCommentPairs) {
  try{
  const additionalCases = authorCommentPairs.filter(c => commentPair !== c)
  const shouldReply = !subredditsThatDisallowBots
    .some(subreddit => subreddit.toLowerCase() === commentPair.copy.subreddit.display_name.toLowerCase())

  const [postResponse] = await Promise.allSettled([
    shouldReply && postReply(
      commentPair.copy,
      createReplyText(commentPair, additionalCases)
    ),
    sendReport(
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

  return {
    author: commentPair.copy.author.name,
    shouldReply,
    hasBotReply,
  }
  } catch (e) {
    console.error(e)
  }
}

// We may have comments exactly up to the depth of comment,
// and we need to check the comment's replies for one of ours.
async function isAlreadyRespondedTo(comment) {
  const replies = comment.replies.length
    ? comment.replies
    : (await comment.expandReplies({ depth: 1 })).replies
  return replies.some(reply => reply.author_fullname === BOT_USER_ID)
}

async function getPlagiaristsFromPosts(posts) {
  return uniqBy(
    (await asyncMap(posts, findCommentPairs)).flat(),
    'copy.author.name'
  ).map(commentPair => commentPair.copy.author.name)
}

async function addCommentToFubarList({ id }) {
  if (
    !await db.get('fubarComments')
      .find({ id })
      .value()
  ) {
    db.get('fubarComments')
      .push({ id, processedAt: Date.now() })
      .write()
  }
}

async function addPostToFubarList(id) {
  if (
    !await db.get('fubarPosts')
      .find({ id })
      .value()
  ) {
    db.get('fubarPosts')
      .push({ id, processedAt: Date.now() })
      .write()
  }
}

function getAuthorCooldown(name) {
  return db.get('authorCooldowns')
    .find({ name })
    .value()
}

async function addOrUpdateAuthorCooldown(name, cooldownStart, cooldownEnd, copyCount) {
  if (
    !await db.get('authorCooldowns')
      .find({ name })
      .value()
  ) {
    db.get('authorCooldowns')
      .push({ name, cooldownStart, cooldownEnd, copyCount })
      .write()
  } else {
    db.get('authorCooldowns')
      .assign({ name, cooldownStart, cooldownEnd, copyCount })
      .write()
  }
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

function populateQueue(subreddits) {
  return subreddits.map(subreddit => () => run(subreddit))
}

async function isCommentFubar ({ id }) {
  return !!await db.get('fubarComments')
    .find({ id })
    .value()
}

async function isPostFubar ({ id }) {
  return !!await db.get('fubarPosts')
    .find({ id })
    .value()
}

async function isAuthorOnCooldown (author) {
  return (await getAuthorCooldown(author))?.cooldownEnd > Date.now()
}

// maybe change all to cooldown rather than fubar for simplification
async function cleanup() {
  await db.get('authorCooldowns')
    .remove(({ cooldownEnd }) => cooldownEnd < Date.now())
    .write()

  await db.get('fubarComments')
    .remove(({ processedAt }) => processedAt < Date.now() - 1000 * 60 * 60 * 24)
    .write()

  await db.get('fubarPosts')
    .remove(({ processedAt }) => processedAt < Date.now() - 1000 * 60 * 60 * 24)
    .write()
}

const subreddits = [
  'pcmasterrace',
  'videos',
  'AnimalsBeingBros',
  'funnyvideos',
  'mildlyinteresting',
  'pics',
  'antiMLM',
  'explainlikeimfive',
  'StarWars',
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
]

;(async function () {
  while (true) {
    try {
      const authors = uniqBy(
        (await asyncMapSerial(subreddits, (subreddit) => run({ subreddit }).catch(console.error))).flat(),
      )
      await run({ authors })
      await cleanup()
    } catch (e) {
      console.error(`something went wrong:`)
      console.error(e)
    }
  }
})()

// run({
//   authors: [
//     'kevboomin'
//   ],
//   logTable: true,
// })

module.exports = run
