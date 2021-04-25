require('dotenv').config()
const Snoowrap = require('snoowrap')
const uniqBy = require('lodash/uniqBy')
const flatMap = require('lodash/flatMap')
const chunk = require('lodash/chunk')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const { findPlagiarismCases, isSimilar } = require('./find-plagiarism-cases')
const { createReplyText, createReportText } = require('./create-summary-text')

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
snoowrap.config({ requestDelay: 100, continueAfterRatelimitError: true })

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
]

// Some posts simply won't return /u/reply-guy-bot comments for seemingly no reason.
// If duplicate bot replies are noticed, comment should go here -_-
const fubarCommentIds = []

async function run ({
  subreddit,
  authors
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
    async author => !await isAuthorTrusted(author)
  )

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

  console.log('plagiarismCases.length', plagiarismCases.length)

  await asyncMap(
    authors,
    async (author) => {
      const authorPlagiarismCases = plagiarismCases
        .filter((plagiarismCase) => plagiarismCase.plagiarized.author.name === author)

      if (
        authorPlagiarismCases.length >= MIN_PLAGIARIST_CASES
          && !isAuthorRepetitive(authorPlagiarismCases)
      ) {
        console.log('123', 123)
        await asyncMap(
          await asyncFilter(
            authorPlagiarismCases,
            shouldProcessPlagiarismCase,
          ),
          async (plagiarismCase) => await processPlagiarismCase(plagiarismCase, authorPlagiarismCases)
        )
      } else {
        console.log(`trusting ${author}`)
        await addAuthorToTrustedList(author)
      }
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
  return flatMap(await getPostsByAuthor(author), findPlagiarismCases)
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

function asyncMap(arr, cb) {
  return Promise.all(arr.map(cb))
}

async function asyncMapSerial(arr, cb) {
  const responses = []
  const arrCopy = [ ...arr ]
  while (arrCopy.length) {
    responses.push(await cb(arrCopy.shift()))
  }
  return responses
}

async function asyncFilter (arr, cb) {
  return (await asyncMap(
    arr,
    async function (element) {
      if (await cb(...arguments)) {
        return element
      }
    }
  ))
  .filter(Boolean)
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
  let posts = []
  try {
    posts = await snoowrap.getUser(authorName).getComments({ limit: AUTHOR_POST_LIMIT })
      .map((comment) => getPostWithComments(comment.link_id)
        .then(post =>
          !post.comments.some(c => c.id === comment.id)
          ? { ...post, comments: post.comments.concat(comment) }
          : post
        )
      )
  } catch (e) {
    await addAuthorToFubarList(authorName)
  }
  return posts
}

function postReply(comment, message) {
  return subredditsThatDisallowBots
    .find(subreddit => subreddit.toLowerCase() === comment.subreddit.display_name.toLowerCase())
      ? null
      : comment.reply(message)
        .catch((e) => addCommentToFubarList(comment))
}

function sendReport(comment, message) {
  return comment.report({ reason: message })
    .catch((e) => { console.error(`Couldn't report comment: `, e.message) })
}

async function shouldProcessPlagiarismCase (plagiarismCase) {
  return !await isCommentFubar(plagiarismCase.plagiarized)
    && !isCommentTooOld(plagiarismCase.plagiarized)
    && !await isAlreadyRespondedTo(plagiarismCase.plagiarized)
}

async function processPlagiarismCase (plagiarismCase, authorPlagiarismCases) {
  const additionalCases = authorPlagiarismCases.filter(c => plagiarismCase !== c)
  return Promise.all([
    postReply(
      plagiarismCase.plagiarized,
      createReplyText(plagiarismCase, additionalCases)
    ),
    sendReport(
      plagiarismCase.plagiarized,
      createReportText(plagiarismCase)
    ),
  ])
    .then(async ([postedComment]) => new Promise((resolve, reject) => {
      // wait 10 seconds and see if our comments are included.
      // maybe could simplify
      if (postedComment) {
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
            console.log(`success: http://reddit.com${postedComment.permalink}`)
            console.log('=======')
          } else {
            await addCommentToFubarList(plagiarismCase.plagiarized)
          }
          resolve(plagiarismCase)
        }, 1000 * 30)
      } else {
        console.log('plagiarismCase.plagiarized.subreddit', plagiarismCase.plagiarized.subreddit)
        resolve(plagiarismCase)
      }
    }))
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
    await addCommentToFubarList(comment)
  }
}

function getPlagiaristsFromPosts(posts) {
  return asyncFilter(
    uniqBy(
      flatMap(posts, findPlagiarismCases),
      'plagiarized.author.name'
    ).map(plagiarismCase => plagiarismCase.plagiarized.author.name),
    async (authorName) => !await isAuthorFubar(authorName)
  )
}

async function addCommentToFubarList({ id, created, permalink }) {
  if (
    !await db.get('fubarComments')
      .find({ id })
      .value()
  ) {
    console.log(`fubar comment: http://reddit.com${permalink}`)
    db.get('fubarComments')
      .push({ id, created })
      .write()
  }
}

async function addAuthorToFubarList(name) {
  if (
    !await db.get('fubarAuthors')
      .find({ name })
      .value()
  ) {
    console.log(`fubar author: ${name}`)
    db.get('fubarAuthors')
      .push({ name })
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
      .push({ name, trustedAt: Date.now() })
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

async function isAuthorFubar (name) {
  return !!await db.get('fubarComments')
    .find({ name })
    .value()
}

async function isAuthorTrusted (name) {
  return !!await db.get('trustedAuthors')
    .find({ name })
    .value()
}

function cleanup() {
  return db.get('trustedAuthors')
    .remove(({trustedAt}) => trustedAt < Date.now() - 1000 * 60 * 60 * 24 * 3)
    .write()
}

const subreddits = [
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

module.exports = run
