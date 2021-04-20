require('dotenv').config()
const Snoowrap = require('snoowrap')
const uniqBy = require('lodash/uniqBy')
const flatMap = require('lodash/flatMap')
const findPlagiarismCases = require('./find-plagiarism-cases')
const createCommentText = require('./create-comment-text')

const queue = {}

const snoowrap = new Snoowrap({
  userAgent: 'reply-guy-bot',
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  username: process.env.REDDIT_USER,
  password: process.env.REDDIT_PASS
})
snoowrap.config({ requestDelay: 50, continueAfterRatelimitError: true })

const EXAMPLE_THREAD_ID = 'mnrn3b'
const MEGATHREAD_ID = 'mqlaoo'
const BOT_USER_ID = 't2_8z58zoqn'
const INITIAL_POST_LIMIT = 15
const AUTHOR_POST_LIMIT = 30

const subredditsThatDisallowBots = [
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
  'IAmA'
]

// Some posts simply won't return /u/reply-guy-bot comments for seemingly no reason.
// If duplicate bot replies are noticed, comment should go here -_-
const fubarCommentIds = [
  'gulbtx1',
  'gv2a4an',
]

async function run (subreddit) {
  console.log(`searching in /r/${subreddit}`)

  const plagiarists = getPlagiaristsFromPosts(await getPostsWithComments(subreddit))
  const plagiarismCases = await getPlagiarismCasesFromAuthors(plagiarists)

  // If author is a repeat offender, post a damning comment.
  return asyncMap(plagiarismCases, async plagiarismCase => {
    const additionalCases = plagiarismCases.filter(
      (p) => p.plagiarized.id !== plagiarismCase.plagiarized.id
      && p.plagiarized.author.name === plagiarismCase.plagiarized.author.name
    )

    // Return author name if not repeat offender, for further investigation.
    // A little messy, think about how else to do this
    if (additionalCases.length > 1) {
      await processPlagiarismCase(plagiarismCase, additionalCases)
      return null
    } else {
      return plagiarismCase.plagiarized.author.name
    }
  })
    .then((responses) => {
      console.log(`done searching /r/${subreddit}`)
      return responses.filter(Boolean)
    })
    .catch((e) => console.error(e))
}

async function getPlagiarismCasesFromAuthors(plagiarists) {
  return uniqBy(
    flatMap(
      await asyncFlatMap(
        plagiarists, getPostsWithCommentsByAuthor
      ), (post) => findPlagiarismCases(post, false)
    ),
    'plagiarized.id'
  )
}

function asyncFlatMap(arr, cb) {
  return Promise.all(arr.map(cb)).then(resolved => resolved.flat())
}

function asyncMap(arr, cb) {
  return Promise.all(arr.map(cb))
}

// FIXME: seems like post metadata is lost?
// Not needed currently but a little dragonsy
async function getPostsWithComments(subreddit) {
  let posts = []
  try {
    // posts = await snoowrap.getHot(subreddit, {limit: INITIAL_POST_LIMIT})
    posts = await snoowrap.getHot({limit: INITIAL_POST_LIMIT})
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

async function getPostsWithCommentsByAuthor(authorName) {
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
    console.log(`could not get posts for author ${authorName}`)
  }
  return posts
}

function postComment(plagiarismCase, message) {
  return subredditsThatDisallowBots
    .find(subreddit => subreddit.toLowerCase() === plagiarismCase.original.subreddit.display_name.toLowerCase())
    ? null
    : plagiarismCase.plagiarized.reply(message)
    .catch((e) => {
      console.error(`Couldn't post comment: `, e.message)
      console.log('plagiarismCase.plagiarized', plagiarismCase.plagiarized)
    })
}

function reportComment(plagiarismCase, message) {
  return plagiarismCase.plagiarized.report(message)
    .catch((e) => { console.error(`Couldn't report comment: `, e.message) })
}

async function processPlagiarismCase (plagiarismCase, additionalCases) {
  if(
    !fubarCommentIds.some((commentId) => plagiarismCase.plagiarized.id === commentId)
    && !await isAlreadyRespondedTo(plagiarismCase)
    && plagiarismCase.plagiarized.created > Date.now() / 1000 - 60 * 60 * 24 * 3
  ) {
    const replyText = createCommentText(
      plagiarismCase,
      additionalCases,
    )
    const reportText = createCommentText(
      plagiarismCase,
      additionalCases,
      true
    )
    return Promise.all([
      postComment(plagiarismCase, replyText),
      reportComment(plagiarismCase, reportText)
    ])
      .then(async ([postedComment]) => {
        if (postedComment && await isAlreadyRespondedTo(plagiarismCase)) {
          console.log('=======')
          console.log(`http://reddit.com/u/${plagiarismCase.plagiarized.author.name}`)
          console.log(`http://reddit.com${postedComment.permalink}`)
          console.log('=======')
        } else if (postedComment) {
          console.log(`comment screwed up: http://reddit.com${postedComment.permalink}`)
        }
      })
  }
}

// We may have comments exactly up to the depth of comment,
// and we need to check the comment's replies for one of ours.
async function isAlreadyRespondedTo(plagiarismCase) {
  try {
    const replies = plagiarismCase.plagiarized.replies.length
      ? plagiarismCase.plagiarized.replies
      : (await plagiarismCase.plagiarized.expandReplies({ depth: 1 })).replies

    return replies.some(reply => reply.author_fullname === BOT_USER_ID)
  } catch (e) {
    console.error(`could not retrieve comment replies for: http://reddit.com${plagiarismCase.plagiarized.permalink}`)
    // If something goes wrong with this, we shouldn't post.
    return true
  }
}

function getPlagiaristsFromPosts(posts) {
  return uniqBy(
    flatMap(posts, post => findPlagiarismCases(post, false)),
    'plagiarized.author.name'
  )
    .map(plagiarismCase => plagiarismCase.plagiarized.author.name)
}

const subreddits = [
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
  'books',
  'europe',
  'nottheonion',
  'IAmA',
  'pcmasterrace',
  'Superstonk',
  'videos',
  'AskReddit',
  'AnimalsBeingBros',
  'funnyvideos',
  'mildlyinteresting',
  'pics',
  'antiMLM',
  'explainlikeimfive',
  'StarWars',
  'cursedcomments',
  'fedex',
  'gifs',
  'worldnews',
  'NatureIsFuckingLit',
  'funny',
]

// // For human investigation
// async function getAuthorReport(plagiarist) {
//   const [first, ...rest] = (await getPlagiarismCasesFromAuthors([plagiarist]))
//     .filter((plagiarismCase) => plagiarismCase.plagiarized.author.name === plagiarist)
//   console.log(createCommentText(first, rest, true))
// }
// getAuthorReport('BraveDelay8869')

;(async function () {
  let i = 0
  const additionalAuthorsToInvestigate = new Set((await run(subreddits[0])))
  setInterval(async () => {
    i++
    try {
      const moreToInvestigate = await run(subreddits[i % subreddits.length])
      moreToInvestigate.forEach((author) => {
        additionalAuthorsToInvestigate.add(author)
      })
      // until an automated strategy is implemented, just log all of them cumulatively
      // for a human to look at later
      console.log('additional authors:')
      for (let author of additionalAuthorsToInvestigate) console.log(`'${author}',`)

    } catch (e) {
      console.log(`something went wrong: ${e.message}`)
    }
  }, 1000 * 60 * 3)
})()

module.exports = run
