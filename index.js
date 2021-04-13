// TODO: be safer about potential repetition-as-meme false positives?
require('dotenv').config()
const uniqBy = require('lodash/uniqBy')
const flatMap = require('lodash/flatMap')

const Snoowrap = require('snoowrap')

const snoowrap = new Snoowrap({
  userAgent: 'reply-guy-bot',
  clientId: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  username: process.env.REDDIT_USER,
  password: process.env.REDDIT_PASS
})

const EXAMPLE_THREAD_ID = 'mnrn3b'
const MEGATHREAD_ID = 'mnugzl'
const BOT_USER_ID = 't2_8z58zoqn'
const INITIAL_POST_LIMIT = 30
const AUTHOR_POST_LIMIT = 3

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
  return asyncMap(plagiarismCases, plagiarismCase => {
    const additionalCases = plagiarismCases.filter(
      (p) => {
        return p.plagiarized.id !== plagiarismCase.plagiarized.id
        && p.plagiarized.author.name === plagiarismCase.plagiarized.author.name
      }
    )
    if (additionalCases.length > 1) {
      return postComment(plagiarismCase, additionalCases[0])
    } else {
      console.log('-------')
      console.log(`http://reddit.com${plagiarismCase.plagiarized.permalink}`)
      console.log(plagiarismCase.plagiarized.body)
      console.log('-------')
    }
  })
  .then(() => console.log('done'))
}

function asyncFlatMap(arr, cb) {
  return Promise.all(arr.map(cb)).then(resolved => resolved.flat())
}

function asyncMap(arr, cb) {
  return Promise.all(arr.map(cb))
}

async function getPostsWithComments(subreddit) {
  return snoowrap.getHot(subreddit, {limit: INITIAL_POST_LIMIT})
    .map(post => getPostWithComments(post.id).catch(e => console.error(e)))
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
        c.body === comment.body
        && c.body.length > 12
        && c.created > comment.created
        && c.body !== '[removed]'
        && c.body !== '[deleted]'
        && c.body !== '[deleted]'
        && c.body !== post.comments.find(comment => comment.name === c.parent_id)?.body
        && c.parent_id !== comment.parent_id
        && c.author_fullname !== comment.author_fullname
        && !c.replies.some(reply => reply.author_fullname == BOT_USER_ID)
    )

    return plagiarized
      ? [ ...acc, { original: comment, plagiarized } ]
      : acc
  }, [])
}

async function getPostsWithCommentsByAuthor(author) {
  try {
    return await snoowrap.getUser(author.name).getComments({ limit: AUTHOR_POST_LIMIT })
      .map((comment) => getPostWithComments(comment.link_id))
  } catch (e) {
    console.log(`could not find posts for author ${author.name}`)
  }
}

function postComment(currentCase, additionalCase) {
  const message = createMessage(currentCase, additionalCase)
  console.log('message', message)
  return Promise.all([
    snoowrap.getSubmission(MEGATHREAD_ID).reply(message),
    // currentCase.plagiarized.reply(message)
  ])
}

// function createMessage(currentCase, additionalCase) {
//   return `This comment was copied from [this one](${currentCase.original.permalink}) elsewhere in this comment section.

//   It is probably not a coincidence, because this user has done it before with [this](${additionalCase.plagiarized.permalink}) comment that copies [this one](${additionalCase.original.permalink}).

//   ^(beep boop, I'm a bot. It is this bot's opinion that) [^(/u/${currentCase.plagiarized.author.name})](https://www.reddit.com/u/${currentCase.plagiarized.author.name}/) ^(should be banned for spamming. A human checks in on this bot sometimes.)
//   `
// }

function createMessage(currentCase, additionalCase) {
  return `[This](http://reddit.com${currentCase.plagiarized.permalink}) comment was copied from [this one](http://reddit.com${currentCase.original.permalink}) at the top level of this comment section.

  It is probably not a coincidence, because this user has done it before with [this](http://reddit.com${additionalCase.plagiarized.permalink}) comment that copies [this one](http://reddit.com${additionalCase.original.permalink}).
  `
}

// const subreddits = ['u_reply-guy-bot']

const subreddits = [
  'OldSchoolCool',
  'nosleep',
  'personalfinance',
  'creepy',
  'TwoXChromosomes',
  'funny',
  'AskReddit',
  'gaming',
  'aww',
  'Music',
  'pics',
  'science',
  'worldnews',
  'todayilearned',
  'videos',
  'movies',
  'news',
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
  'nottheonion',
  'DIY',
  'mildlyinteresting',
  'sports',
  'space',
  'gadgets',
  'blog',
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
  'memes',
  'WritingPrompts',
]

let i = 0
run(subreddits[0])
setInterval(async () => {
  i++
  await run(subreddits[i % subreddits.length])
}, 1000 * 60 * 1)
