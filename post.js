const uniqBy = require('lodash/uniqBy')
const stripComment = require('./strip-comment')

module.exports = class Post {
  constructor(post) {
  const {
    id,
    comments,
    duplicatePostIds = [],
    post_hint,
    domain,
    removed_by_category,
  } = post

    if (!comments) {
      console.log('broken post', post)
    }

    this.id = id
    this.comments = flattenComments(comments).map(stripComment)
    this.duplicatePostIds = duplicatePostIds
    this.post_hint = post_hint
    this.domain = domain
    this.removed_by_category = removed_by_category
  }
}

function flattenComments(comments) {
  try {
  return uniqBy(comments.reduce((acc, comment) => {
    if (!comment.replies?.length) {
      return [ ...acc, comment ]
    } else {
      // return [ ...acc, comment, ...flattenComments(comment.replies) ]
      return [ ...acc, comment, ...flattenComments(comment.replies) ]
    }
  }, []), 'id')
  } catch (e) {
    console.log(arguments)
    console.log('e', e)
  }
}
