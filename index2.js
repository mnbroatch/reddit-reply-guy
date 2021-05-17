require('dotenv').config()
const Snoowrap = require('snoowrap')
const Data = require('./Data')
const {
  asyncMap,
  asyncMapSerial,
  asyncFilter,
  asyncReduce,
  asyncFind,
} = require('./async-array-helpers')

const snoowrap = new Snoowrap({
  userAgent: 'reply-guy-bot',
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  username: process.env.REDDIT_USER,
  password: process.env.REDDIT_PASS
})

snoowrap.config({ continueAfterRatelimitError: true, requestTimeout: 100 })

const {
  EXAMPLE_THREAD_ID,
  MEGATHREAD_ID,
  BOT_USER_ID,
} = process.env
const INITIAL_POST_LIMIT = +process.env.INITIAL_POST_LIMIT 
const AUTHOR_POST_LIMIT = +process.env.AUTHOR_POST_LIMIT
const POST_CHUNK_SIZE = +process.env.POST_CHUNK_SIZE
const MIN_PLAGIARIST_CASES = +process.env.MIN_PLAGIARIST_CASES
const MAX_COMMENT_AGE = +process.env.MAX_COMMENT_AGE
const INITIAL_COOLDOWN = +process.env.INITIAL_COOLDOWN
const REPLY_BOT_USERS = JSON.parse(process.env.REPLY_BOT_USERS)

const subredditsThatDisallowBots = [
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
  'funny',
  'Futurology',
  'Gaming',
  'Games',
  'WTF',
  'memes',
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
]

async function getPostIdsFromSubreddit (subreddit) {
  try {
  let x = await snoowrap.getHot(subreddit, { limit: INITIAL_POST_LIMIT })
  console.log('x2', x)
  return x.map(post => post.id)
  } catch (e) {
    console.log('e', e)
    console.log('123123', 123123)
  }
}

async function run ({
  author,
  authors = author ? [ author ] : [],
  data = new Data(),
  dryRun,
  logTable,
  post,
  posts = post ? [ post ] : [],
  subreddit,
  subreddits = subreddit ? [ subreddit ] : [],
}) {
  const postIdsToProcess = new Set()
  if (subreddits.length) {
    ;(await asyncMap(subreddits, getPostIdsFromSubreddit))
      .flat()
      .forEach((postId) => { postIdsToProcess.add(postId) })
  }

  console.log('postIdsToProcess', postIdsToProcess)




  try {
    await fetchAndAddComments(data) // maybe strip these
    console.log('3==================================================')
    tagRepetitiveComments(data)
    await findAndAddCommentPairs(data)
    // could fetch more comments by guilty authors here
    console.log('4==================================================')

    await tagAuthorsWithInsufficientEvidence(data)

    if (logTable) {
      logTables(data)
    }

    console.log('5==================================================')
    await traverseCommentPairs(
      data,
      async (commentPair, authorCommentPairs) => {
        if (commentPair.failureReason) {
          // not sure why we'd get here
          console.log('commentPair.failureReason', commentPair.failureReason)
        } else if (isCommentTooOld(commentPair.copy)) {
          commentPair.failureReason = 'tooOld'
        } else {
          try {
            if (await isCommentAlreadyRepliedTo(commentPair.copy)) {
              commentPair.failureReason = 'alreadyReplied'
            }
          } catch (e) {
            console.log('e', e)
            console.error(`couldn't get replies for: http://reddit.com${commentPair.copy.permalink}`)
            commentPair.failureReason = 'broken'
          }
        }

        if (!commentPair.failureReason && dryRun) {
          commentPair.failureReason = 'dryRun'
        }

        if (!commentPair.failureReason) {
          commentPair.additional = authorCommentPairs.filter(c => commentPair !== c)
          await reportCommentPair(commentPair)
          if (shouldReply(commentPair)) {
            await replyToCommentPair(commentPair)
          } else {
            commentPair.noReply = 'true'
          }
        }

        if (commentPair.failureReason === 'broken') {

        }
      }
    )
    console.log('6==================================================')
  } catch (e) {
    console.error(e)
  }

  data.authors
    .filter(authorData => authorData.failureReason !== 'newlySpotted')
    .forEach((authorData) => {
      console.log('--------------------')
      console.log(authorData.author)
      console.log(`${authorData.commentPairs.length} total cases`)
      if (authorData.failureReason === 'insufficientEvidence' && authorData.commentPairs.length) {
        console.log('insufficient evidence:')
        authorData.commentPairs.forEach((commentPair) => {
          console.log('commentPair.copy.body', commentPair.copy.body)
          console.log(`http://reddit.com${commentPair.copy.permalink}`)
        })
      } else if (authorData.failureReason) {
        console.log(authorData.failureReason)
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
          if (commentPair.noReply) {
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

  return data.authors
    .filter(authorData => authorData.failureReason === 'newlySpotted')
    .map(authorData => authorData.commentPairs)
    .flat()
}


// function createInitialData(authors, commentPairsByAuthor) {
//   const authors = authors, commentPairsByAuthor.map(authorCommentPairs => j)
//   const data = 
//
//   const initialCommentPairs = uniqBy(
//     [
//       ...commentPairs.map(commentPair => ({ ...commentPair, failureReason: null })),
//       ...(subreddit ? await findCommentPairsInSubreddit(subreddit, data.searchedPosts) : [])
//     ],
//     'copy.id'
//   )
//
//
//
//   Object.entries(groupBy(initialCommentPairs, 'author'))
//     .forEach(([author, authorCommentPairs]) => {
//       data.authors[]
//     })
//       ...acc,
//       {
//         author,
//         comments: [],
//         commentPairs: authorCommentPairs,
//         failureReason: null
//       }
//     ], [])
//
//   authors.forEach((author) => {
//     if (!data.authors.some(authorData => authorData.author === author)) {
//       data.authors.push({
//         author,
//         comments: [],
//         commentPairs: [],
//         failureReason: null
//       })
//     }
//   })
// }

function groupCommentsBySimilarBody (comments) {
  return comments.reduce((acc, comment) => {
    const maybeKey = Object.keys(acc).find(body => isSimilar(comment.body, body, .67))
    return maybeKey
      ? { ...acc, [maybeKey]: [ ...acc[maybeKey], comment ] }
      : { ...acc, [comment.body]: [comment] }
  }, {})
}

async function findAndAddCommentPairs(data) {
  const commentsToSearch = uniqBy(
    data.authors.reduce((acc, authorData) => [
      ...acc,
      ...authorData.comments
        .filter(comment => !authorData.author.failureReason && !comment.failureReason)
    ], []),
    'link_id'
  )
  
  const commentPairs = (await asyncMapSerial(
    chunk(commentsToSearch, POST_CHUNK_SIZE),
    commentsToSearchChunk => asyncMap(
      commentsToSearchChunk,
      async (commentToSearch) => {
        try {
          console.log(`getting post: ${commentToSearch.link_id} from comment: ${commentToSearch.id} `)
          const post = await getPost(commentToSearch.link_id, data.searchedPosts)
          const existingPostComments = data.authors.reduce((acc, authorData) => [
            acc,
            ...authorData.comments.filter(c => c.link_id === commentsToSearch.link_id),
          ], [])
          const postComments = uniqBy(
            [ ...existingPostComments, ...post.comments ],
            'id'
          )
          const postCommentsByAuthor = groupBy(
            postComments,
            'author.name'
          )

          Object.entries(postCommentsByAuthor).forEach(([author, authorComments]) => {
            const maybeAuthorData = data.authors.find(authorData => authorData.author === author)
            if (maybeAuthorData) {
              const authorCommentsByBody = groupCommentsBySimilarBody(
                uniqBy([ ...authorComments, ...maybeAuthorData.comments ], 'id')
              )
              Object.values(authorCommentsByBody).forEach((similarComments) => {
                if (similarComments.length > 1) {
                  similarComments.forEach((comment) => {
                    comment.failureReason = 'repetitiveAuthor'
                  })
                }
              })
            }
          })
          return findCommentPairsInPost({
            ...post,
            comments: postComments.filter(comment => !comment.failureReason)
          })
        } catch (e) {
          console.error(e)
          console.error(`Could not get post: http://reddit.com${comment.permalink}`)
          return []
        }
      }
    )
  )).flat().flat()

  Object.entries(groupBy(commentPairs, 'author'))
    .forEach(([ author, authorCommentPairs ]) => {
      const authorData = data.authors.find(data => data.author === author)
      if (authorData) {
        authorData.commentPairs = uniqBy([ ...authorData.commentPairs, ...authorCommentPairs ], 'copy.id')
      } else {
        data.authors.push({
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

async function fetchAndAddComments(data) {
  await asyncMap(data.authors, async (authorData) => {
    if (!authorData.failureReason) {
      authorData.comments = await getCommentsFromAuthor(authorData.author)
    }
  })
}

// If an author posts the same thing repeatedly, we will
// assume they are just being boring, not plagiarizing.
function tagRepetitiveComments(data) {
  data.authors.forEach((authorData) => {
    if (!authorData.failureReason) {
      const authorCommentsByBody = groupCommentsBySimilarBody(authorData.comments)
      Object.values(authorCommentsByBody).forEach((similarComments) => {
        if (similarComments.length > 1) {
          similarComments.forEach((comment) => {
            comment.failureReason = 'repetitiveAuthor'
            const maybeAuthorData = data.authors.find(data => data.author === comment.author.name)
            const maybeCommentPair = maybeAuthorData?.commentPairs.find(commentPair => comment.id === commentPair.copy.id)
            if (maybeCommentPair) {
              maybeCommentPair.failureReason = 'repetitiveAuthor'
            }
          })
        }
      })
    }
  })
}

async function tagAuthorsWithInsufficientEvidence(data) {
  await asyncMap(data.authors, async (authorData) => {
    if (!authorData.failureReason && authorData.commentPairs.length < MIN_PLAGIARIST_CASES) {
      authorData.failureReason = 'insufficientEvidence'
    }
  })
}

async function traverseCommentPairs(data, cb) {
  await asyncMap(data.authors, async (authorData) => {
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
          if (await isCommentAlreadyRepliedTo(commentPair.copy)) {
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

async function reportCommentPair (commentPair) {
  try {
    await commentPair.copy.report({ reason: createReplyText(commentPair) })
    commentPair.reportSuccess = true
  } catch (e) {
    commentPair.failureReason = 'broken'
    console.error(`Couldn't report comment: http://reddit.com${commentPair.copy.permalink}`)
  }
}

async function logTables (data) {
  data.authors.forEach((authorData) => {
    if (!authorData.failureReason && authorData.commentPairs.length) {
      console.log('----------------------------------')
      console.log('authorData.author', authorData.author)
      console.log(createTable(authorData.commentPairs))
    }
  })
}

async function getInitialPosts(subreddit, searchedPosts) {
  let posts = []
  try {
    posts = asyncMap(
      
      async post => getPost(await post.id, searchedPosts)
    )
  } catch (e) {
    console.error(`Could not get posts from ${subreddit}: `, e.message)
  }
  return posts
}

async function getPost (postId, searchedPosts) {
  const post = await snoowrap.getSubmission(postId)

  const duplicates = await getDuplicatePosts(post)

  const comments = (await asyncMap(
    await asyncFilter([ post, ...duplicates ], async dupe => !searchedPosts.has(await dupe.id)),
    async dupe => {
      searchedPosts.add(await dupe.id)
      return flattenReplies(await dupe.comments)
    }
  )).flat()

  return {
    id: await post.id,
    comments
  }
}

// maybe do both searches?
async function getDuplicatePosts(post) {
  const postId = await post.id
  console.log(`getting duplicates meta of ${postId}`)
  let duplicatePostIds = []
  try {
    if (await !canTryImageSearch(post)) throw new Error()
    duplicatePostIds = await axios.get(`https://api.repostsleuth.com/image?filter=true&url=https:%2F%2Fredd.it%2Fn9p6fa&postId=${postId}&same_sub=false&filter_author=false&only_older=false&include_crossposts=true&meme_filter=false&target_match_percent=90&filter_dead_matches=false&target_days_old=0`)
      .then(response => response.data.matches.map(match => match.post.post_id))
  } catch (e) {
    duplicatePostIds = (await asyncMap(
      await snoowrap.oauthRequest({
        uri: '/api/info',
        method: 'get',
        qs: {
          url: await post.url,
        }
      }),
      async dupeMeta => await dupeMeta.id
    )).filter(dupeId => dupeId !== postId)
  }

  return asyncMap(
    duplicatePostIds,
    (dupeId) => {
      console.log(`getting duplicate: ${dupeId}`)
      return snoowrap.getSubmission(dupeId)
    }
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
    console.log(`getting author comments from: ${author}`)
    return snoowrap.getUser(author).getComments({ limit: AUTHOR_POST_LIMIT })
  } catch (e) {
    console.error(e)
    console.error(`couldn't get author comments: http://reddit.com/u/${author}`)
    return []
  }
}

async function isCommentAlreadyRepliedTo(comment) {
  console.log(`checking if comment is replied to: ${comment.id}`)
  const replies = await snoowrap.getComment(comment.id).expandReplies({ depth: 1 }).replies
  if (comment.id === 'gxsdcvk') console.log('replies.map(r => r.author.name)', replies.map(r => r.author.name))
  return replies.some(
    reply => REPLY_BOT_USERS.some(
      user => {
        console.log('-------------')
        console.log('user', user)
        console.log('reply.author.name', reply.author.name)
        return user.toLowerCase() === reply.author.name.toLowerCase()
      }
    )
  )
}

async function findCommentPairsInSubreddit (subreddit, searchedPosts) {
  return (await asyncMap(
    await getInitialPosts(subreddit, searchedPosts),
    findCommentPairsInPost,
  )).flat()
}

function isCommentTooOld({ created }) {
  return created * 1000 < Date.now() - MAX_COMMENT_AGE
}

function shouldReply (commentPair) {
  return !subredditsThatDisallowBots.some(
    subreddit => subreddit.toLowerCase() === commentPair.copy.subreddit.display_name.toLowerCase()
  )
}


const subreddits = [
  'OldSchoolCool',
  'ShowerThoughts',
  'aww',
  'memes',
  'DIY',
  'LifeProTips',
  'all',
  'popular',
  'AskReddit',
  'pcmasterrace',
  'videos',
  'gadgets',
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
]

;(async function () {
  await run({ subreddit: 'Music' })
  let dryRun
  let logTable
  // dryRun = true
  // logTable = true

  // while (true) {
  //   try {
  //     await cleanup(MAX_COMMENT_AGE)
  //     await asyncMapSerial(
  //       subreddits,
  //       async (subreddit) => {
  //         try {
  //           const commentPairs = await run({ subreddit, dryRun, logTable })
  //           console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~')
  //           console.log(`authors:`)
  //           if (commentPairs.length) uniqBy(commentPairs, 'author').forEach((cp) => { console.log(cp.author) })
  //           console.log('~~~~~~~~~~~~~~~~~~~~~~~~~~~')
  //           if (commentPairs.length) {
  //             await run({ commentPairs, dryRun })
  //           }
  //         } catch (e) {
  //           console.error(`something went wrong:`)
  //           console.error(e)
  //         }
  //       }
  //     )
  //   } catch (e) {
  //     console.error(`something went wrong:`)
  //     console.error(e)
  //   }
  // }
  //
  // run({
  //   dryRun: true,
  //   logTable: true,
  //   authors: [
  //     'tbmadduxnvcvx',
  //   ],
  //   // subreddit: '',
  // })

})()

module.exports = run

