const compareTwoStrings = require('string-similarity').compareTwoStrings

const authorWhitelist = [
  'SaveVideo',
  'savevideobot',
  'Quoterm',
  'Lars_porsenna',
  // 'Jaysog',
  '[deleted]',
]

const subredditWhitelist = [
  'FreeKarma4U',
  'Superstonk',
  // '196',
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
  console.log('===================')
  console.log('comment.link_id', comment.link_id)
  console.log('comment.body', comment.body)
  while (parentId !== comment.link_id) {
    console.log('----------------')
    console.log('parentId', parentId)
    const parent = post.comments.find(c => c.name === parentId)
    if (parent) {
      console.log('parent.body', parent.body)
      ancestors.push(parent)
      parentId = parent.parent_id
    } else {
      console.log('999999', 999999)
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
  const verbose = process.env.VERBOSE 
  return post.comments.reduce((acc, comment) => {
    const plagiarized = post.comments.find(c => {
      return criteria.every((criterion, i) => {
        const doesPass = criterion.test(comment, c, post)
        if (verbose && !doesPass && i > 4) {
          console.log('~~~~~~~~~~~~~~~')
          console.log(`failed: ${criterion.description}`)
          console.log(`${c.body.slice(0, 50)}${c.body.length > 50 ? '...' : ''}`)
          console.log('c.plagiarized.author.name', c.author.name)
          console.log(`http://reddit.com${c.permalink}`)
          console.log(`http://reddit.com${comment.permalink}`)
          console.log('~~~~~~~~~~~~~~~')
        }
        return doesPass
      })
    })

    if (plagiarized) {
      console.log('~~~~~~~~~~~~~~~')
      console.log('comment.body', comment.body)
      console.log('~~~~~~~~~~~~~~~')
    }

    return plagiarized
      ? [ ...acc, { original: comment, plagiarized } ]
      : acc
  }, [])
}

module.exports = { isSimilar, findPlagiarismCases }

function isSimilar(str1, str2) {
  return compareTwoStrings(stripQuote(str1), stripQuote(str2)) > .97
}
