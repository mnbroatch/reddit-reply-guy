const uniqBy = require('lodash/uniqBy')
const isSimilar = require('./is-similar')
const groupCommentsBySimilarBody = require('./group-comments-by-similar-body')

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
    description: 'Is the comment different from post body?', // really only happens in copypasta subs
    test: (maybeCopy, original, comments, post) => !isSimilar(maybeCopy.body, post.selftext)
  },
  {
    description: 'Is a whole long thread not being copied?',
    test: (maybeCopy, original, comments) => {
      // If a long thread is copied, we consider it a meme like redditsings.
      // We remain agnostic about comment placement in the heirarchy because
      // people don't remember lyrics in the right order.
      const relatedComments = uniqBy([
        ...maybeCopy.ancestors,
        ...original.ancestors,
        maybeCopy,
        original,
        ...getDescendants(maybeCopy, comments),
        ...getDescendants(original, comments)
      ], 'id')

      const commentsByBody = groupCommentsBySimilarBody(relatedComments, SIMILARITY_THRESHOLD_LOOSE)
      const copiedBodyCount = Object.values(commentsByBody).filter(similarComments => similarComments.length > 1).length
      const result = copiedBodyCount < 5

      // temp to examine potential false negatives
      if (!result) {
        console.log(`------------------------`)
        console.log(`malarkey! new test failed, long thread copied:`)
        console.log('copiedBodyCount', copiedBodyCount)
        console.log('maybeCopy.author', maybeCopy.author)
        console.log()
        console.log(maybeCopy.body)
        console.log(`https://reddit.com${maybeCopy.permalink}`)
        console.log('original.author', original.author)
        console.log(original.body)
        console.log(`https://reddit.com${original.permalink}`)
        console.log(`------------------------`)
      }

      return result
    }
  },
]

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

function getDescendants(comment, comments) {
  const children = getChildren(comment, comments)
  return children.reduce((acc, child) => [ ...acc, ...getDescendants(child, comments) ], [...children])
}

module.exports = function (maybeCopy, original, comments, post) {
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
      comments,
      post
    )
  )
}

