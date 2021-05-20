module.exports = function stripComment({
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
