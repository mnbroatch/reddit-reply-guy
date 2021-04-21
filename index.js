require('dotenv').config()
const Snoowrap = require('snoowrap')
const uniqBy = require('lodash/uniqBy')
const flatMap = require('lodash/flatMap')
const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const findPlagiarismCases = require('./find-plagiarism-cases')
const createCommentText = require('./create-comment-text')

const adapter = new FileSync('db/db.json')
const db = low(adapter)

db
  .defaults({
    fubarComments: [],
    fubarAuthors: [],
  })
  .write()

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
  'IAmA',
  'todayilearned',
]

// Some posts simply won't return /u/reply-guy-bot comments for seemingly no reason.
// If duplicate bot replies are noticed, comment should go here -_-
const fubarCommentIds = []

async function run (subreddit) {
  console.log(`searching in /r/${subreddit}`)

  const plagiarists = await getPlagiaristsFromPosts(await getPostsWithComments(subreddit))

  // const plagiarists = Array.from(new Set([
  //   'Good_Independent_596',
  //   'Beneficial_Road1050',
  //   'OrgalorgLives',
  //   'ZetikaGaming',
  //   'Powerful-Restaurant5',
  //   'AlertedCoyote',
  //   'IChirpI',
  //   'jenggodzilla',
  //   'DominickLemos89',
  //   'WayneKennedy75',
  //   'stabilityinfinity',
  //   'variableHockey',
  //   '_ThatOneLurker_',
  //   'NothingDoing1967',
  //   // 'BrokenCog2020',
  //   // 'jigsawertret34534',
  //   // 'BigLock637',
  //   // 'yzheqqweqwe21321',
  //   // 'AcidSecs',
  //   // 'Sosumi_rogue',
  //   // 'VacationNo9451',
  //   // 'MuchBar1571',
  //   // 'RainGreedy3880',
  //   // 'MarionberryDry9211',
  //   // 'CapablePerspective53',
  //   // 'ConsiderationNo1351',
  //   // 'hillsons',
  //   // 'Dustin_Bromain',
  //   // 'lupul28',
  //   // 'big-loose-bruce',
  //   // 'returnonyolo',
  //   // 'PerformanceDouble957',
  //   // 'Z_El',
  //   // 'Intelligent-Stock912',
  //   // 'SensitiveScreenSos',
  //   // 'poppa_koils',
  // ]))

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
        plagiarists,
        getPostsWithCommentsByAuthor
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

async function asyncFilter (arr, cb) {
  return (await asyncMap(
    arr,
    async (element) => {
      if (await cb(...arguments)) {
        return element
      }
    }
  ))
  .filter(Boolean)
}

// FIXME: seems like post metadata is lost?
// Not needed currently but a little dragonsy
async function getPostsWithComments(subreddit) {
  let posts = []
  try {
    posts = await snoowrap.getHot(subreddit, {limit: INITIAL_POST_LIMIT})
    // posts = await snoowrap.getHot({limit: INITIAL_POST_LIMIT})
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

function reportComment(comment, message) {
  return comment.report(`reply-guy`)
    .catch((e) => { console.error(`Couldn't report comment: `, e.message) })
}

async function processPlagiarismCase (plagiarismCase, additionalCases) {
  if(
    !await isCommentFubar(plagiarismCase.plagiarized)
    && !isCommentTooOld(plagiarismCase.plagiarized)
    && !await isAlreadyRespondedTo(plagiarismCase.plagiarized)
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
      postReply(plagiarismCase.plagiarized, replyText),
      reportComment(plagiarismCase.plagiarized, reportText)
    ])
      .then(async ([postedComment]) => new Promise((resolve, reject) => {
        // wait 10 seconds and see if our comments are included.
        if (postedComment) {
          console.log('456', 456)
          setTimeout(async () => {
            let alreadyResponded
            try {
              alreadyResponded = await isAlreadyRespondedTo(plagiarismCase.plagiarized)
            } catch (e) {
              console.log('e', e)
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
        }
      }))
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
    await addCommentToFubarList(comment)
  }
}

function getPlagiaristsFromPosts(posts) {
  return asyncFilter(
    uniqBy(
      flatMap(posts, post => findPlagiarismCases(post, false)),
      'plagiarized.author.name'
    ).map(plagiarismCase => plagiarismCase.plagiarized.author.name),
    (authorName) => !isAuthorFubar(authorName)
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

function isCommentFubar ({ id }) {
  return db.get('fubarComments')
    .find({ id })
    .value()
}

function isAuthorFubar ({ name }) {
  return db.get('fubarComments')
    .find({ name })
    .value()
}

function isCommentTooOld({ created }) {
  return created < Date.now() / 1000 - 60 * 60 * 24 * 3
}

const subreddits = [
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
