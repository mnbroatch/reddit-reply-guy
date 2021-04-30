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
    description: 'Was original comment created first?',
    test: (maybeCopy, original) =>
      maybeCopy.created > original.created,
  },
  {
    description: 'Is comment actually there?',
    test: (maybeCopy) => 
      maybeCopy.body !== '[removed]'
      && maybeCopy.body !== '[deleted]'
  },
  {
    description: 'Is body long enough?',
    test: (maybeCopy) =>
      stripQuote(maybeCopy.body).length > 15,
  },
  {
    description: 'Is author copying someone other than themselves?',
    test: (maybeCopy, original) => 
      original.author_fullname !== maybeCopy.author_fullname 
  },
  {
    description: 'Do non-root comments have different parents?',
    test: (maybeCopy, original) => 
      original.parent_id === original.link_id
      || original.parent_id !== maybeCopy.parent_id
  },
  {
    description: 'Is subreddit not whitelisted?',
    test: (maybeCopy) =>
      !subredditWhitelist
        .find(subreddit => subreddit.toLowerCase() === maybeCopy.subreddit.display_name.toLowerCase())
  },
  {
    description: 'Is author not whitelisted?',
    test: (maybeCopy) =>
      !authorWhitelist.includes(maybeCopy.author.name),
  },
  {
    description: 'Is body not a reddit shorthand link?',
    test: (maybeCopy) => {
      const firstWord = maybeCopy.body.split(' ')[0]
      return maybeCopy.body.length > firstWord.length * 2
        || !/^\/?u\//.test(firstWord) && !/^\/?r\//.test(firstWord) 
    },
  },
  {
    description: 'Are these comments similar?',
    test: (maybeCopy, original) =>
      isSimilar(original.body, maybeCopy.body)
  },
  {
    description: 'Is the comment different from ancestors?',
    test: (maybeCopy, original, post) =>
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
// We could make api calls to avoid this.
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

function findCommentPairsInPost(post) {
  return asyncReduce(post.comments, async (acc, comment, i) => {
    const maybeCopy = await findCommentCopy(comment, post, i)
    return maybeCopy
      ? [ ...acc, { original: comment, copy: maybeCopy } ]
      : acc
  }, [])
}

// startingIndex prevents double checks
function findCommentCopy (original, post, startingIndex) {
  try {
    return asyncFind(post.comments.slice(startingIndex + 1), maybeCopy =>
      asyncEvery(criteria, async (criterion, i) => {
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
    return false
  }
}

function logCriterionFailure (criterion, maybeCopy, original, i) {
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

module.exports = { isSimilar, findCommentPairsInPost }

function isSimilar(str1, str2) {
  return compareTwoStrings(stripQuote(str1), stripQuote(str2)) > .97
}
