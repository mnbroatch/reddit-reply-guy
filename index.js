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
const INITIAL_POST_LIMIT = 100
const AUTHOR_POST_LIMIT = 5
async function run (subreddit) {
  console.log('start')

  const posts = await getPostsWithComments(subreddit)

  console.log(`starting with ${posts.length} posts in /r/${subreddit}`)

  const plagiarists = uniqBy(flatMap(
    posts,
    (post) => findPlagiarizedCommentsInPost(post).map(post => post.author)
  ), 'name')

  return asyncMap(
    await asyncFlatMap(plagiarists, findPlagiarismCasesByAuthor),
    processPlagiarismCase
  )
    .then(() => { console.log('done') })
}

// Gets plagiarizedComments for a post, and all plagiarized
// cases by the author of all cases of that post.
function findPlagiarismCasesByPostDeep(post) {
  return asyncFlatMap(
    uniqBy(findPlagiarizedCommentsInPost(post), 'author.name'),
    (comment) => findPlagiarismCasesByAuthor(comment.author)
  )
}

function asyncFlatMap(arr, cb) {
  return Promise.all(arr.map(cb)).then(resolved => resolved.flat())
}

function asyncMap(arr, cb) {
  return Promise.all(arr.map(cb))
}

async function getPostsWithComments(subreddit) {
  return snoowrap.getHot(subreddit, {limit: INITIAL_POST_LIMIT}).map(post => getPostWithComments(post.id).catch(e => console.error(e)))
}

async function getPostWithComments (postId) {
  const post = await snoowrap.getSubmission(postId)
  return { ...post, comments: await post.comments }
}

function processPlagiarismCase (plagiarismCase, _, plagiarismCases) {
  const additionalCase = plagiarismCases.find(
    (p) => p.plagiarized.id !== plagiarismCase.plagiarized.id
      && p.plagiarized.author.name === plagiarismCase.plagiarized.author.name
  )
  if (additionalCase) {
    return postComment(plagiarismCase, additionalCase)
  }
}

// Could make this search more reply levels
// move filter?
function findPlagiarizedCommentsInPost(post) {
  const x = post.comments.flatMap((comment) => comment.replies
    .filter((reply) =>
      !reply.replies.some((r) => r.author_fullname === BOT_USER_ID) // we already commented
      && findCopiedComment(reply, post))
  )
  return x
}

async function findPlagiarismCasesByAuthor(author) {
  let plagiarismCases
  try {
    return await snoowrap.getUser(author.name).getComments({ limit: AUTHOR_POST_LIMIT })
      .map(async (comment) => {
        // Could optimize here to ensure we don't get post multiple times
        const post = await getPostWithComments(comment.link_id)
        const original = findCopiedComment(comment, post)

        return original
          ? {
              plagiarized: comment,
              original
            }
          : null
      })
      .filter(Boolean)
  } catch (e) {
    console.error('e', e)
    console.error(`could not get comments for author ${author.name}`)
  }
  return plagiarismCases || []
}

function findCopiedComment(reply, post) {
  // console.log('reply.body', reply.body)
  // post.comments.forEach((comment) => {
  //   console.log('comment.body', comment.body)
  // })
  post.comments.forEach((comment) => {
    if (
      comment.body === reply.body
      && comment.body !== '[removed]'
      && comment.body !== '[deleted]'
    ) {
      console.log('comment.body', comment.body)
      console.log(`http://reddit.com${comment.permalink}`)
    }
  })
  return post.comments.find((comment) => comment.body === reply.body
    && reply.created > comment.created
    && comment.body !== '[removed]'
    && comment.body !== '[deleted]'
    && reply.author_fullname !== comment.author_fullname
    && !isMemeRepetition(reply, post)
    && comment.parent_id !== comment.link_id
  )
}

// Useful for 'F' chains, bot invocations, etc.
function isMemeRepetition(reply, post) {
  const parent = post.comments.find(comment => comment.name === reply.parent_id)
  return parent?.body === reply.body
  && !reply.replies.some(r => r.body === reply.body)
}

function postComment(currentCase, additionalCase) {
  const message = createMessage(currentCase, additionalCase)
  console.log('message', message)
  return Promise.all([
    snoowrap.getSubmission(MEGATHREAD_ID).reply(message),
    // currentCase.plagiarized.reply(message)
  ])
}

function createMessage(currentCase, additionalCase) {
  return `This comment was copied from [this one](${currentCase.original.permalink}) at the top level of this comment section.

  It is probably not a coincidence, because this user has done it before with [this](${additionalCase.plagiarized.permalink}) comment that copies [this one](${additionalCase.original.permalink}).

  ^(beep boop, I'm a bot. It is this bot's opinion that) [^(/u/${currentCase.plagiarized.author.name})](https://www.reddit.com/u/${currentCase.plagiarized.author.name}/) ^(should be banned for spamming. A human checks in on this bot sometimes.)
  `
}

function createMessage(currentCase, additionalCase) {
  return `[This](${currentCase.original.permalink}) comment was copied from [this one](${currentCase.original.permalink}) at the top level of this comment section.

  It is probably not a coincidence, because this user has done it before with [this](${additionalCase.plagiarized.permalink}) comment that copies [this one](${additionalCase.original.permalink}).
  `
}

// const subreddits = ['u_reply-guy-bot']

const subreddits = [
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
]

let i = 0
run(subreddits[0])
setInterval(async () => {
  i++
  await run(subreddits[i % subreddits.length])
}, 1000 * 60 * 1)
