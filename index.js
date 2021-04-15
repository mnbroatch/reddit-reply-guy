require('dotenv').config()
const Snoowrap = require('snoowrap')
const compareTwoStrings = require('string-similarity').compareTwoStrings
const uniqBy = require('lodash/uniqBy')
const flatMap = require('lodash/flatMap')

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
const INITIAL_POST_LIMIT = 25
const AUTHOR_POST_LIMIT = 25

const subredditsThatDisallowBots = [ 'AskReddit' ]

const subredditsThatDisallowLinks = [
  'pcmasterrace',
  'politics', // disallows /u/username callouts, should handle separately?
]

async function run (subreddit) {
  console.log(`searching in /r/${subreddit}`)

  // Gets authors of duplicate comments on a post
  const plagiarists = uniqBy(
    flatMap(await getPostsWithComments(subreddit), findPlagiarismCases),
    'plagiarized.author.name'
  )
    .map(plagiarismCase => plagiarismCase.plagiarized.author)

  // then searches each's comment history for more cases of plagiarism 
  const plagiarismCases = uniqBy(
    flatMap(await asyncFlatMap(plagiarists, getPostsWithCommentsByAuthor), findPlagiarismCases),
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
      && !await isAlreadyRespondedTo(plagiarismCase)
    ) {
      const commentText = createMessage(
      plagiarismCase,
      additionalCases,
      subredditsThatDisallowLinks.find(subreddit => subreddit.toLowerCase() === plagiarismCase.original.subreddit.display_name.toLowerCase())
    )
      const reportText = createMessage(plagiarismCase, additionalCases)
      return Promise.all([
        postComment(plagiarismCase, commentText),
        reportComment(plagiarismCase, reportText)
      ])
    } else if (additionalCases.length < 2) {
      console.log('-------')
      console.log(`http://reddit.com${plagiarismCase.plagiarized.permalink}`)
      console.log(plagiarismCase.plagiarized.body)
      console.log('additionalCases.length', additionalCases.length)
      console.log('-------')
    }
  })
    .then(() => console.log('done')) // firing too early
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

function findPlagiarismCases(post) {
  return post.comments.reduce((acc, comment) => {
    const plagiarized = post.comments.find(c =>
      isSimilar(comment, c)
      && c.body.length > 20
      && c.created > comment.created
      && c.body !== '[removed]'
      && c.body !== '[deleted]'
      && c.body !== '[deleted]'
      && c.parent_id !== comment.parent_id
      && c.author_fullname !== comment.author_fullname
      && !isSimilarToAncestor(c, post)
    )

    return plagiarized
      ? [ ...acc, { original: comment, plagiarized } ]
      : acc
  }, [])
}

function isSimilar(comment1, comment2) {
  return compareTwoStrings(stripQuote(comment1.body), stripQuote(comment2.body)) > .97
}

function stripQuote(comment) {
  return comment.split('\n')
    .filter(line => line.trim()[0] !== '>')
    .join('\n')
}

// Breaks if we didn't fetch the whole thread from root to comment.
// Currently if it breaks, we consider it not to match an ancestor.
function isSimilarToAncestor(comment, post) {
  const ancestors = []
  let parentId = comment.parent_id 
  while (parentId !== comment.link_id) {
    const parent = post.comments.find(c => c.name === parentId)
    if (parent) {
      ancestors.push(parent)
      parentId = parent.parent_id
    } else break
  }

  return ancestors.some(ancestor => isSimilar(comment, ancestor))
}

async function getPostsWithCommentsByAuthor(author) {
  let posts = []
  try {
    posts = await snoowrap.getUser(author.name).getComments({ limit: AUTHOR_POST_LIMIT })
      .map((comment) => getPostWithComments(comment.link_id)
        .then(post =>
          !post.comments.some(c => c.id === comment.id)
          ? { ...post, comments: post.comments.concat(comment) }
          : post
        )
      )
  } catch (e) {
    console.log(`could not get posts for author ${author.name}`)
  }
  return posts
}

function postComment(plagiarismCase, message) {
  if (!subredditsThatDisallowBots.find(subreddit => subreddit.toLowerCase() === plagiarismCase.original.subreddit.display_name.toLowerCase())) return Promise.resolve([])
  console.log(`about to post comment to: http://reddit.com${plagiarismCase.plagiarized.permalink}`)
  return plagiarismCase.plagiarized.reply(message)
    .then((reply) => {
      console.log(`posted http://reddit.com${reply.permalink}`)
    })
  .catch((e) => { console.error(`Couldn't post comment: `, e.message) })
}

function reportComment(plagiarismCase, message) {
  console.log(`about to report comment: http://reddit.com${plagiarismCase.plagiarized.permalink}`)
  return plagiarismCase.plagiarized.report(message)
    .then((reply) => {
      console.log(`reported comment`)
    })
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
    // If something goes wrong, we shouldn't post.
    return true
  }
}

function createMessage(currentCase, additionalCases, noLinks) {
  return noLinks
    ? `It looks like this comment was plagiarized from another in this comment section. The rules of this subreddit do not allow me to link to it, but it is not the first time I've seen this user do this.

^(beep boop, I'm a bot. It is this bot's opinion that the user above should be banned for spamming. A human checks in on this bot sometimes, so please reply if I made a mistake.)
  `
    : `This comment was copied from [this one](${currentCase.original.permalink}) elsewhere in this comment section.

  It is probably not a coincidence, because this user has done it before with [this](${additionalCases[0].plagiarized.permalink}) comment that copies [this one](${additionalCases[0].original.permalink}).

  ^(beep boop, I'm a bot. It is this bot's opinion that) [^(/u/${currentCase.plagiarized.author.name})](https://www.reddit.com/u/${currentCase.plagiarized.author.name}/) ^(should be banned for spamming. A human checks in on this bot sometimes, so please reply if I made a mistake.)
  `
}

// function createMessage(currentCase, additionalCase) {
//   return `[This](http://reddit.com${currentCase.plagiarized.permalink}) comment was copied from [this one](http://reddit.com${currentCase.original.permalink}) at the top level of this comment section.

//   It is probably not a coincidence, because this user has done it before with [this](http://reddit.com${additionalCase.plagiarized.permalink}) comment that copies [this one](http://reddit.com${additionalCase.original.permalink}).
//   `
// }

// const subreddits = ['u_reply-guy-bot']

const subreddits = [
  'videos',
  'movies',
  'news',
  'pcmasterrace',
  'Showerthoughts',
  'EarthPorn',
  'IAmA',
  'food',
  'gifs',
  'askscience',
  'Jokes',
  'LifeProTips',
  'explainlikeimfive',
  'books',
  'Art',
  'mildlyinfuriating',
  'nottheonion',
  'DIY',
  'mildlyinteresting',
  'sports',
  'space',
  'gadgets',
  'Documentaries',
  'photoshopbattles',
  'GetMotivated',
  'tifu',
  'UpliftingNews',
  'listentothis',
  'television',
  'dataisbeautiful',
  'history',
  'InternetIsBeautiful',
  'philosophy',
  'Futurology',
  'WritingPrompts',
  'OldSchoolCool',
  'nosleep',
  'personalfinance',
  'creepy',
  'TwoXChromosomes',
  'funny',
  'gaming',
  'aww',
  'Music',
  'memes',
  'pics',
  'science',
  'worldnews',
  'todayilearned',
  'AskReddit',
]

let i = 0

run(subreddits[0])
setInterval(async () => {
  i++
  try {
    await run(subreddits[i % subreddits.length])
  } catch (e) {
    console.log(`something went wrong: ${e.message}`)
  }
}, 1000 * 60 * 2)
