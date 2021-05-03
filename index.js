require('dotenv').config()
const assert = require('assert')
const Snoowrap = require('snoowrap')
const uniqBy = require('lodash/uniqBy')
const chunk = require('lodash/chunk')
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
  getAuthorCooldown,
  addCommentToFubarList,
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
const INITIAL_POST_LIMIT = 10
const AUTHOR_POST_LIMIT = 10
const POST_CHUNK_SIZE = 10
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
  console.log('==================================================')
  console.log(`subreddit: ${subreddit || 'none'}`)

  authors = authors || await getPlagiaristsFromPosts(await getInitialPosts(subreddit))
  // if we were feeling really thrifty we could save the initial posts we find plagiarists in
  console.log('authors', authors)

  const authorsData = await asyncMap(
    authors,
    async (author) => ({
      author,
      comments: [],
      commentPairs: [],
      failureReason: null
    })
  )

  try {
    await tagAuthorsOnCooldown(authorsData)
    await fetchAndAddComments(authorsData)
    await tagRepetitiveAuthors(authorsData)
    await findAndAddCommentPairs(authorsData)
    await tagAuthorsWithInsufficientEvidence(authorsData)
    await tagTooOldCommentPairs(authorsData)
    await tagFubarCommentPairs(authorsData)
    await tagAlreadyRepliedCommentPairs(authorsData)
    await addCommentPairsCrossReferences(authorsData)
    await tagNoReplyCommentPairs(authorsData)
    if (!dryRun) {
      await replyToCommentPairs(authorsData)
      // await reportCommentPairs(authorsData)
    }
    await updateAuthorCooldowns(authorsData)
    await updateCommentCooldowns(authorsData)
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
        Object.entries(groupBy(authorData.commentPairs, 'failureReason')).forEach(([ failureReason, commentPairs ]) => {
          if (failureReason === 'undefined') {
            commentPairs.forEach(commentPair => {
              if (dryRun) {
                console.log(`dry run http://reddit.com${commentPair.copy.permalink}`)
              } else if (commentPair.noReply) {
                console.log(`reported http://reddit.com${commentPair.copy.permalink}`)
              } else {
                console.log(`replied to http://reddit.com${commentPair.copy.permalink}`)
              }
            })
          } else {
            console.log(`${failureReason}: ${commentPairs.length}`)
          }
        })
      }
    })

  return authorsData
    .filter(authorData => authorData.failureReason === 'newlySpotted')
    .map(authorData => authorData.author)
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

// rethink this too
async function updateCommentCooldowns(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    await asyncMap(authorData.commentPairs, async (commentPair) => {
      if (commentPair.failureReason === 'broken') {
        await addCommentToFubarList(commentPair.copy)
      }
    })
  })
}

async function processCommentPairs(authorsData) {
  await asyncMap(
    authorsData.filter(authorData => !authorData.failureReason),
    async (authorData) => {
      const authorCommentPairs = authorData.commentPairs
        .filter(commentPair => !commentPair.failureReason)
      await asyncMap(
        authorCommentPairs,
        commentPair => processCommentPair(
          commentPair,
          authorData.commentPairs
        )
      )
    }
  )
}

async function findAndAddCommentPairs(authorsData) {
  const commentsToSearch = uniqBy(await asyncReduce(
    authorsData,
    async (acc, authorData) => {
      if (!authorData.failureReason) {
        return [
          ...acc,
          ...authorData.comments
            .filter(comment => !comment.failureReason)
        ]
      } else {
        return acc
      }
    },
    []
  ))

  const commentPairs = (await asyncMapSerial(
    chunk(commentsToSearch, POST_CHUNK_SIZE),
    commentsToSearchChunk => asyncMap(
      commentsToSearchChunk,
      async (comment) => {
        try {
          return findCommentPairsInPost(await getPost(comment.link_id))
        } catch {
          console.error(e.message)
          console.error(`Could not get post: ${comment.link_id}`)
          addCommentToFubarList(comment)
          return []
        }
      }
    )
  )).flat().flat()

  const commentPairsByAuthor = groupBy(
    commentPairs,
    'author'
  )

  Object.entries(commentPairsByAuthor).forEach(([ author, authorCommentPairs ]) => {
    const authorData = authorsData.find(data => data.author === author)
    if (authorData) {
      authorData.commentPairs = uniqBy([ ...authorData.commentPairs, ...authorCommentPairs ], 'copy.id')
    } else {
      authorsData.push({
        author,
        comments: [],
        commentPairs: [],
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

async function tagAuthorsOnCooldown(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason && await isAuthorOnCooldown(authorData.author)) {
      authorData.failureReason = 'authorCooldown'
    }
  })
}

async function tagRepetitiveAuthors(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason && await isAuthorRepetitive(authorData.comments)) {
      authorData.failureReason = 'repetitive'
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

async function tagFubarCommentPairs(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason) {
      await asyncMap(authorData.commentPairs, async (commentPair) => {
        if (!commentPair.failureReason && await isCommentFubar(commentPair.copy)) {
          commentPair.failureReason = 'commentCooldown'
        }
      })
    }
  })
}

async function tagTooOldCommentPairs(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason) {
      await asyncMap(authorData.commentPairs, async (commentPair) => {
        if (!commentPair.failureReason && await isCommentTooOld(commentPair.copy)) {
          commentPair.failureReason = 'tooOld'
        }
      })
    }
  })
}

async function tagAlreadyRepliedCommentPairs(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason) {
      await asyncMap(authorData.commentPairs, async (commentPair) => {
        if (!commentPair.failureReason && await isCommentAlreadyRepliedTo(commentPair.copy)) {
          commentPair.failureReason = 'alreadyReplied'
        }
      })
    }
  })
}

async function addCommentPairsCrossReferences(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason) {
      await asyncMap(authorData.commentPairs, async (commentPair) => {
        if (!commentPair.failureReason) {
          commentPair.additional = authorData.commentPairs.filter(c => commentPair !== c)
        }
      })
    }
  })
}

async function tagNoReplyCommentPairs(authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason) {
      await asyncMap(authorData.commentPairs, async (commentPair) => {
        if (
          !commentPair.failureReason
            && subredditsThatDisallowBots
              .some(subreddit => subreddit.toLowerCase() === commentPair.copy.subreddit.display_name.toLowerCase())
      ) {
          commentPair.noReply = true
        }
      })
    }
  })
}

async function replyToCommentPairs (authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason) {
      await asyncMap(authorData.commentPairs, async (commentPair) => {
        if (!commentPair.failureReason && !commentPair.noReply) {
          let response
          try {
            response = await snoowrap.getComment(commentPair.copy.id).reply(createReplyText(commentPair))
          } catch (e) {
            console.error(e)
            commentPair.failureReason = 'broken'
            console.error(`couldn't post reply to: http://reddit.com${commentPair.copy.permalink}`)
          }
          if (response) {
            await new Promise((resolve, reject) => {
              setTimeout(async () => {
                try {
                  const x = await isCommentAlreadyRepliedTo(commentPair.copy, true)
                  if (!x) throw new Error('asdasdasd')
                } catch (e) {
                  console.error(e)
                  commentPair.failureReason = 'broken'
                  console.error(`bot reply not retrieved on: http://reddit.com${commentPair.copy.permalink}`)
                }
                resolve()
              }, 1000 * 30)
            })
          }
        }
      })
    }
  })
}

async function reportCommentPairs (authorsData) {
  await asyncMap(authorsData, async (authorData) => {
    if (!authorData.failureReason) {
      await asyncMap(authorData.commentPairs, async (commentPair) => {
        if (!commentPair.failureReason) {
          try {
            await commentPair.copy.report({ reason: createReplyText(commentPair) })
          } catch (e) {
            commentPair.failureReason = 'broken'
            console.error(`Couldn't report comment: http://reddit.com${comment.permalink}`)
          }
        }
      })
    }
  })
}

// If an author posts the same thing a lot of the time
// we will assume they are just boring and not a plagiarist.
function isAuthorRepetitive(authorComments) {
  // assuming transitivity is slightly wrong but ok for this.
  // similarity threshold is low while I watch for false negatives
  const similarBodyCounts = authorComments.reduce((acc, comment) => {
    const maybeKey = Object.keys(acc).find(body => isSimilar(comment.body, body, .67))
    return maybeKey
      ? { ...acc, [maybeKey]: acc[maybeKey] + 1 }
      : { ...acc, [comment.body]: 1 }
  }, 0)

  // How many comments are similar to others?
  return Object.values(similarBodyCounts).reduce((acc, bodyCount) => {
    return bodyCount > 1 ? acc + bodyCount : acc 
  }, 0) > authorComments.length / 5
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
  const post = await snoowrap.getSubmission(postId)

  // snoowrap api is in a weird state where dupes show up under "comments".
  // They don't show up with comments so we need to getSubmission them -_-
  // https://github.com/not-an-aardvark/snoowrap/issues/320
  const duplicates = await asyncMap(
    await post.num_duplicates
      ? await post.getDuplicates().comments 
      : [],
    async (dupe) => snoowrap.getSubmission(await dupe.id)
  )

  const comments = (await asyncMap(
    [ post, ...duplicates ],
    async dupe => flattenReplies(await dupe.comments)
  )).flat()

  return {
    id: await post.id,
    comments
  }
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

async function getPlagiaristsFromPosts(posts) {
  return uniqBy(
    (await asyncMap(posts, findCommentPairsInPost)).flat(),
    'copy.author.name'
  ).map(commentPair => commentPair.author)
}

async function updateAuthorCooldown(name, copyCount = 0) {
  const maybeAuthor = await getAuthorCooldown(name)
  const now = Date.now()

  // cooldown doubles up to 1 day unless new cases are found.
  let cooldownEnd
  if (
    copyCount > MIN_PLAGIARIST_CASES
    && copyCount > maybeAuthor?.copyCount // not stale, count has changed
  ) {
    cooldownEnd = now
  } else {
    cooldownEnd = maybeAuthor
      ? now + Math.min((now - maybeAuthor.cooldownStart) * 2, 1000 * 60 * 60 * 24)
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
  'pcmasterrace',
  'videos',
  'AnimalsBeingBros',
  'funnyvideos',
]

;(async function () {

  const dryRun = false
  // const dryRun = true
  while (true) {
    try {
      await cleanup()
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
    } catch (e) {
      console.error(`something went wrong:`)
      console.error(e)
    }
  }

  // run({
  //   authors: [
  //     'Nithya12M'
  //   ],
  //   // dryRun: true,
  //   // subreddit: 'memes',
  //   // logTable: true,
  // })

})()

module.exports = run

