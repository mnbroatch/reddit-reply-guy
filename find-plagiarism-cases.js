const compareTwoStrings = require('string-similarity').compareTwoStrings

const whitelist = [
  'SaveVideo',
  'savevideobot',
  '[deleted]',
]


const criteria = [
  {
    description: 'Are these comments similar?',
    test: isSimilar
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
    description: 'Is author not whitelisted?',
    test: (original, maybePlagiarized) =>
      !whitelist.includes(maybePlagiarized.author.name),
  },
  {
    description: 'Is body long enough?',
    test: (original, maybePlagiarized) =>
      stripQuote(maybePlagiarized.body).length > 15,
  },
  {
    description: 'Do non-root comments have different parents?',
    test: (original, maybePlagiarized) => 
      original.parent_id === original.link_id
      || original.parent_id !== maybePlagiarized.parent_id
  },
  {
    description: 'Is author copying someone else?',
    test: (original, maybePlagiarized) => 
      original.author_fullname !== maybePlagiarized.author_fullname 
  },
  {
    description: 'Is the comment different from ancestors?',
    test: (original, maybePlagiarized, post) => 
      !isSimilarToAncestor(maybePlagiarized, post)
  },
]

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

function findPlagiarismCases(post, verbose) {
  return post.comments.reduce((acc, comment) => {
    const plagiarized = post.comments.find(c =>
      criteria.every((criterion, i) => {
        const doesPass = criterion.test(comment, c, post)
        if (verbose && !doesPass && i > 2) {
          console.log('~~~~~~~~~~~~~~~')
          console.log(`failed: ${criterion.description}`)

          console.log('c.plagiarized.author.name', c.author.name)
          console.log(`http://reddit.com${c.permalink}`)
          console.log('~~~~~~~~~~~~~~~')
        }
        return doesPass
      })
    )

    return plagiarized
      ? [ ...acc, { original: comment, plagiarized } ]
      : acc
  }, [])
}

module.exports = findPlagiarismCases
