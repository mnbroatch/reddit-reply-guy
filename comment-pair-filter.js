const isSimilar = require('./is-similar')

const criteria = [
  {
    description: 'Is author copying someone other than themselves?',
    test: (maybeCopy, original) => 
      original.author.name !== maybeCopy.author.name 
  },
  {
    description: 'Do non-root comments have different parents?',
    test: (maybeCopy, original) => 
      original.parent_id === original.link_id
      || original.parent_id !== maybeCopy.parent_id
  },
  {
    description: 'Is the comment different from ancestors?',
    test: (maybeCopy, original, comments) =>
      !isSimilarToAncestor(maybeCopy, comments)
  },
]

module.exports = function (maybeCopy, original, comments) {
  return criteria.every(
    criterion => criterion.test(maybeCopy, original, comments)
  )
}

// Breaks if we didn't fetch the whole thread from root to comment.
// Currently if it breaks, we consider it not to match an ancestor.
// We could make more api calls per match to avoid false positives here.
function isSimilarToAncestor(comment, comments) {
  const ancestors = []
  let parentId = comment.parent_id
  while (parentId !== comment.link_id) {
    const parent = comments.find(c => c.name === parentId)
    if (parent) {
      ancestors.push(parent)
      parentId = parent.parent_id
    } else {
      break
    }
  }
  return ancestors.some(ancestor => isSimilar(comment.body, ancestor.body))
}

