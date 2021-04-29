const compareTwoStrings = require('string-similarity').compareTwoStrings
const { asyncMap, asyncFind, asyncEvery, asyncReduce } = require('./async-array-helpers')

const authorWhitelist = [
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
]

const criteria = [
  {
    description: 'Are these comments similar?',
    test: (original, maybeCopy) =>
      isSimilar(original.body, maybeCopy.body)
  },
  {
    description: 'Was original comment created first?',
    test: (original, maybeCopy) =>
      maybeCopy.created > original.created,
  },
  {
    description: 'Is comment still there?',
    test: (original, maybeCopy) => 
      maybeCopy.body !== '[removed]'
      && maybeCopy.body !== '[deleted]'
  },
  {
    description: 'Is body long enough?',
    test: (original, maybeCopy) =>
      stripQuote(maybeCopy.body).length > 15,
  },
  {
    description: 'Is author copying someone else?',
    test: (original, maybeCopy) => 
      original.author_fullname !== maybeCopy.author_fullname 
  },
  {
    description: 'Do non-root comments have different parents?',
    test: (original, maybeCopy) => 
      original.parent_id === original.link_id
      || original.parent_id !== maybeCopy.parent_id
  },
  {
    description: 'Is subreddit not whitelisted?',
    test: (original, maybeCopy) =>
      !subredditWhitelist
        .find(subreddit => subreddit.toLowerCase() === maybeCopy.subreddit.display_name.toLowerCase())
  },
  {
    description: 'Is author not whitelisted?',
    test: (original, maybeCopy) =>
      !authorWhitelist.includes(maybeCopy.author.name),
  },
  {
    description: 'Is body not a reddit shorthand link?',
    test: (original, maybeCopy) => {
      const firstWord = maybeCopy.body.split(' ')[0]
      return maybeCopy.body.length > firstWord.length * 2
        || !/^\/?u\//.test(firstWord) && !/^\/?r\//.test(firstWord) 
    },
  },
  {
    description: 'Is the comment different from ancestors?',
    test: (original, maybeCopy, post) =>
      !isSimilarToAncestor(maybeCopy, post)
  },
]

function stripQuote(comment) {
  return comment.split('\n')
    .filter(line => line.trim()[0] !== '>')
    .join('\n')
}

// Breaks if we didn't fetch the whole thread from root to comment.
// Currently if it breaks, we consider it not to match an ancestor.
function isSimilarToAncestor(comment, post) {
  try {
  const ancestors = []
  let parentId = comment.parent_id 
  while (parentId !== comment.link_id) {
    const parent = post.comments.find(c => c.name === parentId)
    if (parent) {
      ancestors.push(parent)
      parentId = parent.parent_id
    } else {
      break
    }
  }

  return ancestors.some(ancestor => isSimilar(comment.body, ancestor.body))
  } catch (e) {
    console.error(e)
  }
}

// TODO: swallows errors
function findCommentPairs(post) {
  return asyncReduce(post.comments, async (acc, comment, i) => {
    const maybeCopy = await findCommentCopy(comment, post, i)
    return maybeCopy
      ? [ ...acc, { original: comment, copy: maybeCopy } ]
      : acc
  }, [])
}

// startingIndex prevents double checks
function findCommentCopy (original, post, startingIndex) {
  return asyncFind(post.comments.slice(startingIndex + 1), maybeCopy =>
    asyncEvery(criteria, async (criterion, i) => {
  try {
      if (await criterion.test(original, maybeCopy, post)) {
        return true
      } else {
        logCriterionFailure(criterion, original, maybeCopy, i)
        return false
      }
  } catch (e) {
    console.error(e)
  }
    })
  )
}

function logCriterionFailure (criterion, original, maybeCopy, i) {
  if (typeof process.env.VERBOSITY === 'number' && i > VERBOSITY) {
    console.log('~~~~~~~~~~~~~~~')
    console.log(`failed: ${criterion.description}`)
    console.log(`${maybeCopy.body.slice(0, 50)}${maybeCopy.body.length > 50 ? '...' : ''}`)
    console.log('c.maybeCopy.author.name', maybeCopy.author.name)
    console.log(`http://reddit.com${maybeCopy.permalink}`)
    console.log(`http://reddit.com${original.permalink}`)
    console.log('~~~~~~~~~~~~~~~')
  }
}

module.exports = { isSimilar, findCommentPairs }

function isSimilar(str1, str2) {
  return compareTwoStrings(stripQuote(str1), stripQuote(str2)) > .97
}
