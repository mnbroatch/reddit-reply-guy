const isSimilar = require('./is-similar')

const SIMILARITY_THRESHOLD_LOOSE = +process.env.SIMILARITY_THRESHOLD_LOOSE

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
    test: (maybeCopy) => !maybeCopy.ancestors.some(ancestor => isSimilar(maybeCopy.body, ancestor.body))
  },
  {
    description: 'Is a whole long thread not being copied?',
    test: (maybeCopy, original, comments) => {
      const result = !isThreadSectionCopied(maybeCopy, original, comments, 5)

      // temp to examine potential false negatives
      if (!result) {
        console.log(`new test failed, long thread copied:`)
        console.log('maybeCopy', maybeCopy)
        console.log('original', original)
      }

      return result
    }
  },
]

// If a long section of thread is copied, we consider it a meme like redditsings.
// Strategy will be to search ancestors up and child paths down
// until we either have N matches or a mismatch on both ends.
// Issue: We will have thrown away some comments by this point (too short, etc.)
function isThreadSectionCopied(maybeCopy, original, comments, threadSectionMatchThreshold = 5) {
  let ancestorMatchCount = 0
  let currentMaybeCopyAncestor = maybeCopy.ancestors[ancestorMatchCount]
  let currentOriginalAncestor = original.ancestors[ancestorMatchCount]
  while (
    currentMaybeCopyAncestor
      && currentOriginalAncestor
      && isSimilar(currentMaybeCopyAncestor.body, currentOriginalAncestor.body, SIMILARITY_THRESHOLD_LOOSE)
      && ancestorMatchCount < threadSectionMatchThreshold
  ) {
    ancestorMatchCount++
    currentMaybeCopyAncestor = maybeCopy.ancestors[ancestorMatchCount]
    currentOriginalAncestor = original.ancestors[ancestorMatchCount]
  }

  const necessaryChildMatchCount = threadSectionMatchThreshold - ancestorMatchCount

  return necessaryChildMatchCount <= 0
    || isCopiedTreeLargeRecursive(maybeCopy, original, comments, necessaryChildMatchCount)
}

function getAncestors(comment, comments) {
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
  return ancestors
}

function getChildren(comment, comments) {
  return comments.filter((c) => c.parent_id == comment.name)
}

function isCopiedTreeLargeRecursive(node1, node2, comments, threshold) {
  if (!isSimilar(node1.body, node2.body, SIMILARITY_THRESHOLD_LOOSE)) return false
  if (threshold === 1) return true

  const node1Children = getChildren(node1, comments)
  const node2Children = getChildren(node2, comments)

  const validPaths = node1Children.reduce((acc, node1Child) => {
    const node2ChildMatches = node2Children.filter(node2Child => isSimilar(node2Child.body, node1Child.body, SIMILARITY_THRESHOLD_LOOSE))
    if (node2ChildMatches.length > 0) {
      return [
        ...acc,
        ...node2ChildMatches.map(node2Child => ({ node1: node1Child, node2: node2Child }))
      ]
    } else {
      return acc
    }
  }, [])

  if (!validPaths.length) return false

  return validPaths.some(path => isCopiedTreeLargeRecursive(path.node1, path.node2, comments, threshold - 1))
}

module.exports = function (maybeCopy, original, comments) {
  return criteria.every(
    criterion => criterion.test(
      {
        ...maybeCopy,
        ancestors: getAncestors(maybeCopy, comments),
      },
      {
        ...original,
        ancestors: getAncestors(original, comments),
      },
      comments
    )
  )
}

