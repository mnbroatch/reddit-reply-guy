require('dotenv').config()
const Snoowrap = require('snoowrap')
const uniqBy = require('lodash/uniqBy')
const flatMap = require('lodash/flatMap')
const findPlagiarismCases = require('./find-plagiarism-cases')
const createCommentText = require('./create-comment-text')

// const https = require('http-debug').https
// https.debug = 2

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
const AUTHOR_POST_LIMIT = 20

const subredditsThatDisallowBots = [
  'memes',
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
]

// Some posts simply won't return /u/reply-guy-bot comments for seemingly no reason.
// If dupes are noticed they should go here -_- FIXME??????
const fubarCommentIds = [ 'gulbtx1' ]

async function run (subreddit) {
  console.log(`searching in /r/${subreddit}`)

  // // Gets authors of duplicate comments on a post
  // const plagiarists = uniqBy(
  //   flatMap(await getPostsWithComments(subreddit), post => findPlagiarismCases(post, false)),
  //   'plagiarized.author.name'
  // )
  //   .filter(plagiarismCase => plagiarismCase.plagiarized.author.name !== '[deleted]')
  //   .map(plagiarismCase => plagiarismCase.plagiarized.author.name)
  // console.log('plagiarists', plagiarists)

  const plagiarists = [
    'larboard_dango',
    'toastandbananas7',
    'SocrapticMethod',
    'xmagusx',
    'LilyRoseMiles',
    'BandicootUpbeat7639',
    'WesternTea1477',
    // 'Leena_Noor0',
    // 'rilesanders',
    // 'QuarantineSucksALot',
    // 'SnooCrickets3586',
    // 'nexxyPlayz',
    // 'Doopadaptap',
    // 'mug_costanza7',
    // 'Maaysa_Naayla',
    // 'ImAnIndoorCat',
    // 'learnsamsung',
    // 'Vexgullible',
    // 'mncm10',
    // 'sir-jwack',
    // 'EasyReporter5108',
    // 'bojo1313',
    // 'manda_roo89',
    // 'burnisrtyty5465',
    // 'OutrageousTemporary1',
    // 'Morons_comment',
    // 'Deraj2004',
    // '40ozSmasher',
    // 'EEEpic_',
    // '_xXmyusernameXx_',
    // 'MagisterHistoriae',
    // 'Savings_Coach',
    // 'BadGuyBob343',
    // 'RedditTreasures',
    // 'TheDaileyGamer',
    // 'CircumsizedMushroom',
    // 'cantronite',
    // 'Rollsage',
    // 'NeonBladeAce',
    // 'bamwoof',
    // 'debtmen',
    // 'OkPhilosopher13',
    // 'Savings_Coach',
    // 'The-Man-Of-Glass',
    // 'reviewhardly',
    // 'Rollsage',
    // 'kristiansands',
    // 'pro_procrastinator23',
    // 'Kidbluee',
    // 'nsgiad',
    // 'jmay_young',
    // 'mwestadt',
    // 'Maaysa_Naayla',
    // 'SirDextrose',
    // 'eversaur',
    // 'asy_ing944',
    // 'GeorgePierce22',
    // 'greetjack',
    // 'IdeBASto',
    // 'Embermaul',
    // 'nightguys',
    // 'llqqvvnnggreeeaajjk',
    // 'AppropriateExam8',
    // 'themidnightgod',
    // 'RoscoMan1',
  ]

  // then searches each's comment history for more cases of plagiarism ,
  const plagiarismCases = uniqBy(
    flatMap(await asyncFlatMap(plagiarists, getPostsWithCommentsByAuthor), (post) => findPlagiarismCases(post, false)),
    'plagiarized.id'
  )

  // If author is a repeat offender, post a damning comment.
  return asyncMap(plagiarismCases, async plagiarismCase => {
    const additionalCases = plagiarismCases.filter(
      (p) => p.plagiarized.id !== plagiarismCase.plagiarized.id
      && p.plagiarized.author.name === plagiarismCase.plagiarized.author.name
    )

    if (
      additionalCases.length > 1
        && !fubarCommentIds.some((commentId) => plagiarismCase.plagiarized.id === commentId)
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
        .then(([postedComment]) => {
          console.log('=======')
          console.log(`http://reddit.com/u/${plagiarismCase.plagiarized.author.name}`)
          console.log(`http://reddit.com${plagiarismCase.plagiarized.permalink}`)
          console.log('=======')
        })
    } else if (additionalCases.length < 2) {
      console.log(plagiarismCase.plagiarized.author.name)
    }
  })
    .then(() => console.log('done'))
    .catch((e) => console.error(e))
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

// We may have comments exactly up to the depth of comment,
// and we need to check the comment's replies for one of ours.
async function isAlreadyRespondedTo(plagiarismCase) {
  try {
    const replies = plagiarismCase.plagiarized.replies.length
      ? plagiarismCase.plagiarized.replies
      : (await plagiarismCase.plagiarized.expandReplies({ depth: 1 })).replies

    return replies.some(reply => reply.author_fullname === BOT_USER_ID)
  } catch (e) {
    console.error(`weird iterable error: http://reddit.com${plagiarismCase.plagiarized.permalink}`)
    // If something goes wrong with this, we shouldn't post.
    return true
  }
}

const subreddits = [
  'tifu',
  'nextfuckinglevel',
  'gardening',
  'interestingasfuck',
  'relationships',
  'politics',
  'Tinder',
  'news',
  'cats',
  'dogs',
  'Music',
  'Genshin_Impact',
  'movies',
  'Art',
  'blog',
  'nottheonion',
  'pcmasterrace',
  'videos',
  'AskReddit',
  'funnyvideos',
  'mildlyinteresting',
  'pics',
  'explainlikeimfive',
  'worldnews',
  'funny',
  'aww',
  'gaming',
  'food',
  'todayilearned',
  'OutOfTheLoop',
  'BrandNewSentence',
  'madlads',
]

let i = 0
run(subreddits[0])
// setInterval(async () => {
//   i++
//   try {
//     await run(subreddits[i % subreddits.length])
//   } catch (e) {
//     console.log(`something went wrong: ${e.message}`)
//   }
// }, 1000 * 60 * 3)

// module.exports = run
