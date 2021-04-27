require('dotenv').config()
const Snoowrap = require('snoowrap')
const uniqBy = require('lodash/uniqBy')
const flatMap = require('lodash/flatMap')
const chunk = require('lodash/chunk')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const { findPlagiarismCases, isSimilar } = require('./find-plagiarism-cases')
const { createReplyText, createReportText, createTable } = require('./create-summary-text')
const { asyncMap, asyncMapSerial, asyncFilter } = require('./async-array-helpers')

const adapter = new FileSync('db/db.json')
const db = low(adapter)

db
  .defaults({
    fubarComments: [],
    fubarAuthors: [],
    trustedAuthors: [],
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
  if (subreddit) {
    console.log(`searching in /r/${subreddit}`)
  } else {
    console.log(`searching ${authors?.length || 0} authors`)
  }

  // only an optimization, these authors' comments could still be
  // detected in others' retrieved posts.
  authors = await asyncFilter(
    authors || await getPlagiaristsFromPosts(await getPosts(subreddit)),
    async author => !await isAuthorTrusted(author) && !await isAuthorFubar(author)
  )

  console.log('authors', authors)

  const plagiarismCases = uniqBy(
    (await asyncMapSerial(
      chunk(authors, AUTHORS_CHUNK_SIZE),
      async (authorsChunk) => (await asyncMap(
        authorsChunk,
        getPlagiarismCasesFromAuthor
      )).flat()
    )).flat(),
    'plagiarized.id'
  )

  await asyncMap(
    authors,
    async (author) => {
      const authorPlagiarismCases = plagiarismCases
        .filter(plagiarismCase => author === plagiarismCase.plagiarized.author.name)

      if (logTable)  {
        console.log('createTable(plagiarismCases)', createTable(authorPlagiarismCases))
      }

      if (
        authorPlagiarismCases.length >= MIN_PLAGIARIST_CASES
          && !isAuthorRepetitive(authorPlagiarismCases)
      ) {
        await asyncMap(
          await asyncFilter(
            authorPlagiarismCases,
            shouldProcessPlagiarismCase,
          ),
          plagiarismCase => processPlagiarismCase(plagiarismCase, authorPlagiarismCases)
        )
      } else if (authorPlagiarismCases[0]) {
        console.log(`trusting ${authorPlagiarismCases[0].plagiarized.author.name}`)
        await addAuthorToTrustedList(authorPlagiarismCases[0].plagiarized.author.name)
      }
      console.log(`done processing ${author}`)
    }
  )

  console.log(`done searching`)

  // Authors we found along the way, return so we can investigate further
  return plagiarismCases
    .reduce((acc, plagiarismCase) =>
      !authors.includes(plagiarismCase.plagiarized.author.name)
        ? [ ...acc, plagiarismCase.plagiarized.author.name ]
        : acc
    , [])
}

async function getPlagiarismCasesFromAuthor(author) {
  console.log(`getting posts by ${author}`)
  const posts = await getPostsByAuthor(author)
  console.log(`finding plagiarism by ${author}`)
  const plagiarismCases = (await asyncMap(posts, findPlagiarismCases)).flat()
  console.log(`${plagiarismCases.length} plagiarism cases found by ${author}`)
  return plagiarismCases
}

// The idea here is that a copy bot will not always post the same thing.
// Inspired by some commenters that only ever post "sorry for your loss"
// Half might be too generous, especially if bots catch on.
function isAuthorRepetitive(authorPlagiarismCases) {
  return authorPlagiarismCases.reduce((acc, plagiarismCase) => {
    const numSimilar = authorPlagiarismCases
      .filter(c => isSimilar(c.plagiarized.body, plagiarismCase.plagiarized.body))
      .length
    return numSimilar > acc ? numSimilar : acc
  }, 0) > authorPlagiarismCases.length / 2
}

// FIXME: seems like post metadata is lost?
// Not needed currently but a little dragonsy
async function getPosts(subreddit) {
  let posts = []
  try {
    posts = await snoowrap.getHot(subreddit, {limit: INITIAL_POST_LIMIT})
      .map(post => getPostWithComments(post.id))
  } catch (e) {
    console.log(`Could not get posts from ${subreddit}: `, e.message)
  }
  return posts
}

async function getPostWithComments (postId) {
  const post = await snoowrap.getSubmission(postId)
  return { ...post, comments: flattenReplies(await post.comments) }
}

function flattenReplies(comments) {
  return comments.reduce((acc, comment) => {
    if (!comment.replies.length) {
      return [ ...acc, comment ]
    } else {
      return [ ...acc, comment, ...flattenReplies(comment.replies) ]
    }
  }, [])
}

async function getPostsByAuthor(authorName) {
  let authorComments = []
  try {
    authorComments = await snoowrap.getUser(authorName).getComments({ limit: AUTHOR_POST_LIMIT })
  } catch (e) {
    console.log(`fubar author: http://reddit.com/u/${authorName}`)
    await addAuthorToFubarList(authorName)
  }

  return (await asyncMap(
    authorComments,
    async (comment) => {
      try {
        const post = await getPostWithComments(comment.link_id)
        // include starting comment in case we didn't receive it
        return !post.comments.some(c => c.id === comment.id)
          ? { ...post, comments: post.comments.concat(comment) }
          : post
      } catch (e) {
        console.log(`couldn't get post with comment: http://reddit.com${comment.permalink}`)
        await addPostToFubarList(comment.link_id)
        return null
      }
    }
  )).filter(Boolean)
}

function postReply(comment, message) {
  return comment.reply(message)
    .catch(async (e) => {
      console.log(`couldn't post reply to: http://reddit.com${comment.permalink}`)
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

async function shouldProcessPlagiarismCase (plagiarismCase) {
  let alreadyResponded
  try {
    alreadyResponded = await isAlreadyRespondedTo(plagiarismCase.plagiarized)
  } catch (e) {
    console.log(`couldn't get replies for comment: http://reddit.com${comment.permalink}`)
    await addCommentToFubarList(comment)
    return false
  }

  return !await isCommentFubar(plagiarismCase.plagiarized)
    && !isCommentTooOld(plagiarismCase.plagiarized)
    && !alreadyResponded
}

async function processPlagiarismCase (plagiarismCase, authorPlagiarismCases) {
  const additionalCases = authorPlagiarismCases.filter(c => plagiarismCase !== c)
  const shouldReply = !subredditsThatDisallowBots
    .some(subreddit => subreddit.toLowerCase() === plagiarismCase.plagiarized.subreddit.display_name.toLowerCase())

  const [{status: postResponse}] = await Promise.allSettled([
    shouldReply && postReply(
      plagiarismCase.plagiarized,
      createReplyText(plagiarismCase, additionalCases)
    ),
    sendReport(
      plagiarismCase.plagiarized,
      createReportText(plagiarismCase)
    ),
  ])

  if (shouldReply && postResponse.value) {
    // wait some time and see if our comments are included.
    // maybe could simplify
    await new Promise((resolve, reject) => {
      console.log('posted comment, see you in 30 seconds')
      setTimeout(async () => {
        let alreadyResponded
        try {
          alreadyResponded = await isAlreadyRespondedTo(plagiarismCase.plagiarized)
        } catch (e) {
          console.error(e)
          alreadyResponded = false
        }

        if (alreadyResponded) {
          console.log('=======')
          console.log(`success: http://reddit.com${plagiarismCase.plagiarized.permalink}`)
          console.log('=======')
        } else {
          console.log(`bot reply not retrieved on: http://reddit.com${plagiarismCase.plagiarized.permalink}`)
          await addCommentToFubarList(plagiarismCase.plagiarized)
        }

        resolve()
      }, 1000 * 30)
    })
  } else {
    console.log(`not replying to post in ${plagiarismCase.plagiarized.subreddit.display_name}`)
  }
}

// We may have comments exactly up to the depth of comment,
// and we need to check the comment's replies for one of ours.
async function isAlreadyRespondedTo(comment) {
  try {
    const replies = comment.replies.length
      ? comment.replies
      : (await comment.expandReplies({ depth: 1 })).replies
    return replies.some(reply => reply.author_fullname === BOT_USER_ID)
  } catch (e) {
  }
}

async function getPlagiaristsFromPosts(posts) {
  return uniqBy(
    (await asyncMap(posts, findPlagiarismCases)).flat(),
    'plagiarized.author.name'
  ).map(plagiarismCase => plagiarismCase.plagiarized.author.name)
}

async function addCommentToFubarList({ id, created }) {
  if (
    !await db.get('fubarComments')
      .find({ id })
      .value()
  ) {
    db.get('fubarComments')
      .push({ id, created })
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

async function addAuthorToFubarList(name) {
  if (
    !await db.get('fubarAuthors')
      .find({ name })
      .value()
  ) {
    db.get('fubarAuthors')
      .push({ name, processedAt: Date.now() })
      .write()
  }
}

async function addAuthorToTrustedList(name) {
  if (
    !await db.get('trustedAuthors')
      .find({ name })
      .value()
  ) {
    db.get('trustedAuthors')
      .push({ name, processedAt: Date.now() })
      .write()
  }
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

async function isAuthorFubar (name) {
  return !!await db.get('fubarAuthors')
    .find({ name })
    .value()
}

async function isAuthorTrusted (name) {
  return !!await db.get('trustedAuthors')
    .find({ name })
    .value()
}

async function cleanup() {
  await db.get('trustedAuthors')
    .remove(({ processedAt }) => processedAt < Date.now() - 1000 * 60 * 60 * 24)
    .write()

  await db.get('fubarAuthors')
    .remove(({ processedAt }) => processedAt < Date.now() - 1000 * 60 * 60 * 24)
    .write()

  await db.get('fubarComments')
    .remove(({ created }) => created < Date.now() - 1000 * 60 * 60 * 24)
    .write()

  await db.get('fubarPosts')
    .remove(({ processedAt }) => processedAt < Date.now() - 1000 * 60 * 60 * 24)
    .write()
}

const subreddits = [
  'CODWarzone',
  'todayilearned',
  'OutOfTheLoop',
  'iamatotalpieceofshit',
  'BrandNewSentence',
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
  'cursedcomments',
  'gifs',
  'worldnews',
  'NatureIsFuckingLit',
  'funny',
  'aww',
  'gaming',
  'food',
]

;(async function () {
  while (true) {
    try {
      const authors = uniqBy(
        (await asyncMapSerial(subreddits, (subreddit) => run({ subreddit }))).flat(),
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
//     'deSuspect'
//   ],
//   logTable: true,
// })

module.exports = run
