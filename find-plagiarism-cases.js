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
    test: (original, maybePlagiarized) =>
      isSimilar(original.body, maybePlagiarized.body)
  },
  {
    description: 'Was original comment created first?',
    test: (original, maybePlagiarized) =>
      maybePlagiarized.created > original.created,
  },
  {
    description: 'Is comment still there?',
    test: (original, maybePlagiarized) => 
      maybePlagiarized.body !== '[removed]'
      && maybePlagiarized.body !== '[deleted]'
  },
  {
    description: 'Is body long enough?',
    test: (original, maybePlagiarized) =>
      stripQuote(maybePlagiarized.body).length > 15,
  },
  {
    description: 'Is author copying someone else?',
    test: (original, maybePlagiarized) => 
      original.author_fullname !== maybePlagiarized.author_fullname 
  },
  {
    description: 'Do non-root comments have different parents?',
    test: (original, maybePlagiarized) => 
      original.parent_id === original.link_id
      || original.parent_id !== maybePlagiarized.parent_id
  },
  {
    description: 'Is subreddit not whitelisted?',
    test: (original, maybePlagiarized) =>
      !subredditWhitelist
        .find(subreddit => subreddit.toLowerCase() === maybePlagiarized.subreddit.display_name.toLowerCase())
  },
  {
    description: 'Is author not whitelisted?',
    test: (original, maybePlagiarized) =>
      !authorWhitelist.includes(maybePlagiarized.author.name),
  },
  {
    description: 'Is body not a reddit shorthand link?',
    test: (original, maybePlagiarized) => {
      const firstWord = maybePlagiarized.body.split(' ')[0]
      return maybePlagiarized.body.length > firstWord.length * 2
        || !/^\/?u\//.test(firstWord) && !/^\/?r\//.test(firstWord) 
    },
  },
  {
    description: 'Is the comment different from ancestors?',
    test: (original, maybePlagiarized, post) =>
      !isSimilarToAncestor(maybePlagiarized, post)
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
    console.log(e)
  }
}

// TODO: swallows errors
function findPlagiarismCases(post) {
  return asyncReduce(post.comments, async (acc, comment, i) => {
    const plagiarized = await findPlagiarizedComment(comment, post, i)
    return plagiarized
      ? [ ...acc, { original: comment, plagiarized } ]
      : acc
  }, [])
}

// startingIndex prevents double checks
function findPlagiarizedComment (original, post, startingIndex) {
  return asyncFind(post.comments.slice(startingIndex + 1), maybePlagiarized =>
    asyncEvery(criteria, async (criterion, i) => {
  try {
      if (await criterion.test(original, maybePlagiarized, post)) {
        return true
      } else {
        logCriterionFailure(criterion, original, maybePlagiarized, i)
        return false
      }
  } catch (e) {
    console.error(e)
  }
    })
  )
}

function logCriterionFailure (criterion, original, maybePlagiarized, i) {
  if (typeof process.env.VERBOSITY === 'number' && i > VERBOSITY) {
    console.log('~~~~~~~~~~~~~~~')
    console.log(`failed: ${criterion.description}`)
    console.log(`${maybePlagiarized.body.slice(0, 50)}${maybePlagiarized.body.length > 50 ? '...' : ''}`)
    console.log('c.maybePlagiarized.author.name', maybePlagiarized.author.name)
    console.log(`http://reddit.com${maybePlagiarized.permalink}`)
    console.log(`http://reddit.com${original.permalink}`)
    console.log('~~~~~~~~~~~~~~~')
  }
}

module.exports = { isSimilar, findPlagiarismCases }

function isSimilar(str1, str2) {
  return compareTwoStrings(stripQuote(str1), stripQuote(str2)) > .97
}
