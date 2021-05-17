const compareTwoStrings = require('string-similarity').compareTwoStrings
const { asyncMap, asyncFind, asyncEvery, asyncReduce, asyncFilter } = require('./async-array-helpers')

const authorWhitelist = [
  'worldmobilemod',
  'WMTmod',
  'SaveVideo',
  'savevideobot',
  'Quoterm',
  'Lars_porsenna',
  'Jaysog',
  '[deleted]',
]

const subredditWhitelist = [
  'FreeKarma4U',
  'Superstonk',
  '196',
  'RandomActsOfGaming',
]

// probably not robust enough
function stripQuotes(comment) {
  return comment.split('\n')
    .filter(line => line.trim()[0] !== '>')
    .join(' ')
}

function findCommentPairsInPost(post) {
  return asyncReduce(post.comments, async (acc, comment) => {
    const commentPairs = (await findCommentCopies(comment, post))
      .map(copy => ({
        original: stripComment(comment),
        copy: stripComment(copy),
        author: copy.author.name,
        failureReason: null,
      }))
    return [ ...acc, ...commentPairs ]
  }, [])
}

// Subject to breaking if assumptions about snoowrap internals become untrue
function stripComment({
  id,
  name,
  body,
  created,
  author,
  permalink,
  link_id,
  subreddit,
  locked,
  replies = [],
  reply,
  report,
  _r,
  _post,
}) {
  if (locked) {
    console.log('lockarooney')
  }
  return {
    id,
    name,
    body,
    created,
    author,
    permalink,
    link_id,
    subreddit,
    locked,
    replies: [ ...replies.map(({ author }) => ({ author })) ],
    reply,
    report,
    _r,
    _post,
  }
}

// startingIndex prevents double checks
function findCommentCopies (original, post) {
  try {
    return asyncFilter(
      post.comments,
      maybeCopy => asyncEvery(criteria, async (criterion, i) => {
        if (await criterion.test(maybeCopy, original, post)) {
          return true
        } else {
          logCriterionFailure(criterion, maybeCopy, original, i)
          return false
        }
      })
    )
  } catch (e) {
    console.error(e)
    return []
  }
}

function logCriterionFailure (criterion, maybeCopy, original, i) {
  if (maybeCopy.id === '') {
    console.log('~~~~~~~~~~~~~~~')
    console.log(`failed: ${criterion.description}`)
    console.log(`${maybeCopy.body.slice(0, 50)}${maybeCopy.body.length > 50 ? '...' : ''}`)
    console.log(`${original.body.slice(0, 50)}${original.body.length > 50 ? '...' : ''}`)
    console.log('c.maybeCopy.author.name', maybeCopy.author.name)
    console.log(`http://reddit.com${maybeCopy.permalink}`)
    console.log(`http://reddit.com${original.permalink}`)
    console.log('~~~~~~~~~~~~~~~')
  }
}

function isSimilar(str1, str2, threshold = .85) {
  return compareTwoStrings(stripQuotes(str1), stripQuotes(str2)) > threshold
}

module.exports = { isSimilar, findCommentPairsInPost }

