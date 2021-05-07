require('dotenv').config()
const assert = require('assert')
const Snoowrap = require('snoowrap')
const uniqBy = require('lodash/uniqBy')
const chunk = require('lodash/chunk')
const flatMap = require('lodash/flatMap')
const groupBy = require('lodash/groupBy')
const {
  findCommentPairsInPost,
  isSimilar,
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
  asyncReduce,
  asyncFind,
} = require('./async-array-helpers')
const {
  getCommentCooldown,
  getAuthorCooldown,
  addOrUpdateAuthorCooldown,
  addOrUpdateCommentCooldown,
  cleanup,
} = require('./db')

const snoowrap = new Snoowrap({
  userAgent: 'reply-guy-bot',
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  username: process.env.REDDIT_USER,
  password: process.env.REDDIT_PASS
})

snoowrap.config({ continueAfterRatelimitError: true, requestDelay: 300 })

const EXAMPLE_THREAD_ID = 'mnrn3b'
const MEGATHREAD_ID = 'mqlaoo'
const BOT_USER_ID = 't2_8z58zoqn'
const INITIAL_POST_LIMIT = 15
const AUTHOR_POST_LIMIT = 15
const POST_CHUNK_SIZE = 5
const MIN_PLAGIARIST_CASES = 3
const MAX_COMMENT_AGE = 1000 * 60 * 60 * 24 * 3
const INITIAL_COOLDOWN = 1000 * 60 * 60

const subredditsThatDisallowBots = [
  'Futurology',
  'Gaming',
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
  'politics',
]

// Some posts simply won't return /u/reply-guy-bot comments for seemingly no reason.
// If duplicate bot replies are noticed, comment should go here -_-
const fubarCommentIds = []

async function run ({
  subreddit,
  authors = [],
  logTable,
  dryRun,
  commentPairs = [],
}) {
  console.log('==================================================')
  console.log(`subreddit: ${subreddit || 'none'}`)

  const initialCommentPairs = uniqBy(
    [
      ...commentPairs.map(commentPair => ({ ...commentPair, failureReason: null })),
      ...(subreddit ? await findCommentPairsInSubreddit(subreddit) : [])
    ],
    'copy.id'
  )

  const authorsData = Object.entries(groupBy(initialCommentPairs, 'author'))
    .reduce((acc, [author, authorCommentPairs]) => [
      ...acc,
      {
        author,
        comments: [],
        commentPairs: authorCommentPairs,
        failureReason: null
      }
    ], [])

  authors.forEach((author) => {
    if (!authorsData.some(authorData => authorData.author === author)) {
      authorsData.push({
        author,
        comments: [],
        commentPairs: [],
        failureReason: null
      })
    }
  })

  try {
    await tagAuthorsOnCooldown(authorsData)
    await fetchAndAddComments(authorsData) // maybe strip these
    await removeRepetitiveComments(authorsData)
    await tagFubarComments(authorsData)

    await findAndAddCommentPairs(authorsData)
    // could fetch more comments by guilty authors here
    // await findAndAddMoreCommentPairs(authorsData)

    await tagAuthorsWithInsufficientEvidence(authorsData)
    await updateAuthorCooldowns(authorsData)

    if (logTable) {
      logTables(authorsData)
    }

    await traverseCommentPairs(
      authorsData,
      async (commentPair, authorCommentPairs) => {
        // should probably refactor this if else chain
        if (commentPair.failureReason) {
          // shouldn't ever get here
          console.log('commentPair.failureReason', commentPair.failureReason)
        } else if (isCommentTooOld(commentPair.copy)) {
          commentPair.failureReason = 'tooOld'
        } else if (await isCommentOnCooldown(commentPair.copy)) {
          commentPair.failureReason = 'commentCooldown'
        } else {
          try {
            if (await isCommentAlreadyRepliedTo(commentPair.copy)) {
              commentPair.failureReason = 'alreadyReplied'
            }
          } catch (e) {
            console.error(`couldn't get replies for: http://reddit.com${commentPair.copy.permalink}`)
            commentPair.failureReason = 'broken'
          }
        }
          
        if (dryRun && !commentPair.failureReason) {
          commentPair.failureReason = 'dryRun'
        } else if (!commentPair.failureReason) {
          commentPair.additional = authorCommentPairs.filter(c => commentPair !== c)
          await reportCommentPair(commentPair)
          if (shouldReply(commentPair)) {
            await replyToCommentPair(commentPair)
          } else {
            commentPair.noReply = 'true'
          }
        }

        if (commentPair.failureReason === 'broken') {
          await addCommentToFubarList(commentPair.copy)
        }
      }
    )
  } catch (e) {
    console.error(e)
  }

  authorsData
    .filter(authorData => authorData.failureReason !== 'newlySpotted')
    .forEach((authorData) => {
      console.log('--------------------')
      console.log(authorData.author)
      console.log(`${authorData.commentPairs.length} total cases`)
      if (authorData.failureReason) {
        console.log('authorData.failureReason', authorData.failureReason)
      } else {
        const { failed = [], succeeded = [], broken = [] } = groupBy(
          authorData.commentPairs,
          commentPair => {
            if (commentPair.failureReason && !commentPair.reportSuccess) {
              return 'failed'
            } else if (commentPair.reportSuccess && (commentPair.noReply || commentPair.replySuccess)) {
              return 'succeeded'
            } else {
              return 'broken'
            }
          }
        )

        broken.forEach((commentPair) => {
          console.log(`something went wrong with http://reddit.com${commentPair.copy.permalink}`)
          console.log('commentPair.failureReason', commentPair.failureReason)
          console.log('commentPair.reportSuccess', commentPair.reportSuccess)
          console.log('commentPair.replySuccess', commentPair.replySuccess)
          console.log('commentPair.noReply', commentPair.noReply)
        })

        succeeded.forEach((commentPair) => {
          if (dryRun) {
            console.log(`dry run http://reddit.com${commentPair.copy.permalink}`)
          } else if (commentPair.noReply) {
            console.log(`reported http://reddit.com${commentPair.copy.permalink}`)
          } else {
            console.log(`replied to http://reddit.com${commentPair.copy.permalink}`)
          }
        })

        Object.entries(groupBy(failed, 'failureReason')).forEach(([ failureReason, commentPairs ]) => {
          if (failureReason === 'broken') {
            commentPairs.forEach((commentPair) => {
              console.log(`broken: http://reddit.com${commentPair.copy.permalink}`)
            })
          } else {
            console.log(`${failureReason}: ${commentPairs.length}`)
          }
        })
      }
    })

  return authorsData
    .filter(authorData => authorData.failureReason === 'newlySpotted')
    .map(authorData => authorData.commentPairs)
    .flat()
}

// rethink this, too tightly coupled with main function
async function updateAuthorCooldowns(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (authorData.failureReason === 'repetitive') {
      await updateAuthorCooldown(authorData.author)
    } else if (authorData.failureReason !== 'authorCooldown' && authorData.failureReason !== 'newlySpotted') {
      await updateAuthorCooldown(authorData.author, authorData.commentPairs.length)
    }
  })
}

async function findAndAddCommentPairs(authorsData) {
  const commentsToSearch = uniqBy(await asyncReduce(
    authorsData,
    async (acc, authorData) => {
      return [
        ...acc,
        ...authorData.comments
          .filter(comment => !authorData.author.failureReason && !comment.failureReason)
      ]
    },
    []
  ))

  const commentPairs = (await asyncMapSerial(
    chunk(commentsToSearch, POST_CHUNK_SIZE),
    commentsToSearchChunk => asyncMap(
      commentsToSearchChunk,
      async (comment) => {
        try {
          const post = await getPost(comment.link_id)
          return findCommentPairsInPost({ ...post, comments: uniqBy([ ...post.comments, comment ], 'id')})
        } catch (e) {
          console.error(e.message)
          console.error(`Could not get post: http://reddit.com${comment.permalink}`)
          await addCommentToFubarList(comment)
          return []
        }
      }
    )
  )).flat().flat()

  Object.entries(groupBy(commentPairs, 'author'))
    .forEach(([ author, authorCommentPairs ]) => {
      const authorData = authorsData.find(data => data.author === author)
      if (authorData) {
        authorData.commentPairs = uniqBy([ ...authorData.commentPairs, ...authorCommentPairs ], 'copy.id')
      } else {
        authorsData.push({
          author,
          comments: [],
          commentPairs: authorCommentPairs
            .map(commentPair => ({
              ...commentPair,
              failureReason: 'newlySpotted'
            })),
          failureReason: 'newlySpotted'
        })
      }
    })
}

async function fetchAndAddComments(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason) {
      authorData.comments = await getCommentsFromAuthor(authorData.author)
    }
  })
}

async function tagFubarComments(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason) {
      await asyncMap(authorData.comment, async (comment) => {
        if (!comment.failureReason && await isCommentFubar(comment)) {
          comment.failureReason = 'commentCooldown'
        }
      })
    }
  })
}

async function tagAuthorsOnCooldown(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason && await isAuthorOnCooldown(authorData.author)) {
      authorData.failureReason = 'authorCooldown'
    }
  })
}

// If an author posts the same thing repeatedly, we will
// assume they are just being boring and not plagiarizing.
async function removeRepetitiveComments(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason) {
      const authorCommentsByBody = authorData.comments.reduce((acc, comment) => {
        const maybeKey = Object.keys(acc).find(body => isSimilar(comment.body, body, .67))
        return maybeKey
          ? { ...acc, [maybeKey]: [ ...acc[maybeKey], comment ] }
          : { ...acc, [comment.body]: [comment] }
      }, {})
      authorData.comments = Object.values(authorCommentsByBody).reduce((acc, similarComments) => {
        return similarBodies.length < 2
          ? [ ...acc, ...similarBodies ]
          : acc
      }, [])
    }
  })
}

async function tagAuthorsWithInsufficientEvidence(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason && authorData.commentPairs.length < MIN_PLAGIARIST_CASES) {
      authorData.failureReason = 'insufficientEvidence'
    }
  })
}

async function traverseCommentPairs(authorsData, cb) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason) {
      await asyncMap(authorData.commentPairs, async (commentPair) => {
        if (!commentPair.failureReason) {
          await cb(commentPair, authorData.commentPairs)
        }
      })
    }
  })
}

async function replyToCommentPair (commentPair) {
  if (!commentPair.noReply) {
    let response
    try {
      response = await commentPair.copy.reply(createReplyText(commentPair))
    } catch (e) {
      commentPair.failureReason = 'broken'
      console.error(`couldn't post reply to: http://reddit.com${commentPair.copy.permalink}`)
    }
    if (response) {
      await new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            if (await isCommentAlreadyRepliedTo(commentPair.copy, true)) {
              commentPair.replySuccess = true
            } else {
              throw new Error()
            }
          } catch (e) {
            commentPair.failureReason = 'broken'
            console.error(`bot reply not retrieved on: http://reddit.com${commentPair.copy.permalink}`)
          }
          resolve()
        }, 1000 * 30)
      })
    }
  }
}

async function reportCommentPair (commentPair) {
  try {
    await commentPair.copy.report({ reason: createReplyText(commentPair) })
    commentPair.reportSuccess = true
  } catch (e) {
    commentPair.failureReason = 'broken'
    console.error(`Couldn't report comment: http://reddit.com${commentPair.copy.permalink}`)
  }
}

async function logTables (authorsData) {
  authorsData.forEach((authorData) => {
    if (authorData.commentPairs.length) {
      console.log('----------------------------------')
      console.log('authorData.author', authorData.author)
      console.log(createTable(authorData.commentPairs))
    }
  })
}

async function getInitialPosts(subreddit) {
  let posts = []
  try {
    posts = await snoowrap.getHot(subreddit, { limit: INITIAL_POST_LIMIT })
      .map(post => getPost(post.id))
  } catch (e) {
    console.error(`Could not get posts from ${subreddit}: `, e.message)
  }
  return posts
}

async function getPost (postId) {
  const post = await snoowrap.getSubmission(postId)

  const duplicates = await getDuplicatePosts(post)

  const comments = (await asyncMap(
    [ post, ...duplicates ],
    async dupe => flattenReplies(await dupe.comments)
  )).flat()

  return {
    id: await post.id,
    comments
  }
}

// have to use this because getDuplicates doesn't
// return removed submissions
async function getDuplicatePosts(post) {
  const duplicatesMetaData = (await snoowrap.oauthRequest({
    uri: '/api/info',
    method: 'get',
    qs: {
      url: await post.url,
    }
  }))

  return asyncMap(
    await asyncFilter(duplicatesMetaData, async dupeMeta => await dupeMeta.id !== await post.id),
    async (dupeMeta) => snoowrap.getSubmission(await dupeMeta.id)
  )
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

async function getCommentsFromAuthor(author) {
  try {
    return snoowrap.getUser(author).getComments({ limit: AUTHOR_POST_LIMIT })
  } catch (e) {
    console.error(`couldn't get author comments: http://reddit.com/u/${author}`)
    await updateAuthorCooldown(author)
    return []
  }
}

async function isCommentAlreadyRepliedTo(comment, refresh) {
  const replies = !refresh && comment.replies.length
    ? comment.replies
    : await (await snoowrap.getComment(comment.id).expandReplies({ depth: 1 })).replies
  return replies.some(reply => reply.author_fullname === BOT_USER_ID)
}

async function findCommentPairsInSubreddit (subreddit) {
  return (await asyncMap(
    await getInitialPosts(subreddit),
    findCommentPairsInPost
  )).flat()
}

async function updateAuthorCooldown(name, copyCount = 0) {
  const maybeAuthor = await getAuthorCooldown({ name })
  const cooldownStart = Date.now()

  let cooldownEnd
  if (copyCount > maybeAuthor?.copyCount) { // not stale, count has changed
    cooldownEnd = cooldownStart
  } else { // otherwise double cooldown on stale author
    cooldownEnd = maybeAuthor
      ? cooldownStart + Math.min((maybeAuthor.cooldownEnd - maybeAuthor.cooldownStart) * 2, MAX_COMMENT_AGE)
      : cooldownStart + INITIAL_COOLDOWN
  }

  return addOrUpdateAuthorCooldown({
    name,
    cooldownStart,
    cooldownEnd,
    copyCount
  })
}

async function updateCommentCooldown(id) {
  const maybeComment = await getCommentCooldown({ id })
  const cooldownStart = Date.now()

  const cooldownEnd = maybeComment
    ? cooldownStart + Math.min((maybeComment.cooldownEnd - maybeComment.cooldownStart) * 2, MAX_COMMENT_AGE)
    : cooldownStart + INITIAL_COOLDOWN

  return addOrUpdateCommentCooldown({
    id,
    cooldownStart,
    cooldownEnd,
  })
}

function isCommentTooOld({ created }) {
  return created * 1000 < Date.now() - MAX_COMMENT_AGE
}

async function isAuthorOnCooldown (name) {
  return (await getAuthorCooldown({ name }))?.cooldownEnd > Date.now()
}

async function isCommentOnCooldown ({ id }) {
  return (await getCommentCooldown({ id }))?.cooldownEnd > Date.now()
}

function shouldReply (commentPair) {
  return !subredditsThatDisallowBots.some(
    subreddit => subreddit.toLowerCase() === commentPair.copy.subreddit.display_name.toLowerCase()
  )
}


const subreddits = [
  'LifeProTips',
  'all',
  'popular',
  'AskReddit',
  'pcmasterrace',
  'videos',
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
  'gadgets',
  'OldSchoolCool',
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
  'cats',
  'instant_regret',
  'science',
  'Music',
  'Genshin_Impact',
  'movies',
  'Art',
  'blog',
  'aww',
  'memes',
  'DIY',
  'reverseanimalrescue',
  'dataisbeautiful',
  'nonononoyes',
  'ShowerThoughts',
]

;(async function () {
  let dryRun
  // const dryRun = true

  while (true) {
    try {
      await cleanup(MAX_COMMENT_AGE)
      await asyncMapSerial(
        subreddits,
        async (subreddit) => {
          try {
            const commentPairs = await run({ subreddit, dryRun })
            if (commentPairs.length) {
              await run({ commentPairs, dryRun })
            }
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

  // run({
  //   authors: [
  //     'medicaltrot',
  //   ],
  //   // dryRun: true,
  //   // logTable: true,
  //   // subreddit: 'memes',
  // })

})()

module.exports = run

