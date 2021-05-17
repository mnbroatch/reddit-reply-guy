const uniqBy = require('lodash/uniqBy')

module.exports = class Post {
  constructor({
    id,
    comments,
    duplicatePostIds = [],
    post_hint,
    domain,
    removed_by_category,
  }) {
    this.id = id
    this.comments = flattenComments(comments).map(stripComment)
    this.duplicatePostIds = duplicatePostIds
    this.post_hint = post_hint
    this.domain = domain
    this.removed_by_category = removed_by_category
  }
}

function stripComment({
  id,
  name,
  body,
  created,
  author,
  permalink,
  link_id,
  parent_id,
  subreddit,
  replies = [],
}) {
  return {
    id,
    name,
    body,
    created,
    author,
    permalink,
    link_id,
    parent_id,
    subreddit,
    replyAuthors: [ ...replies.map(({ author }) => ({ author: author.name })) ],
  }
}

function flattenComments(comments) {
  return uniqBy(comments.reduce((acc, comment) => {
    if (!comment.replies?.length) {
      return [ ...acc, comment ]
    } else {
      // return [ ...acc, comment, ...flattenComments(comment.replies) ]
      return [ ...acc, comment, ...flattenComments(comment.replies) ]
    }
  }, []), 'id')
}
