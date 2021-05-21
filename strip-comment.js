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
    link_id: link_id.replace(/^t3_/, ''),
    parent_id: parent_id.replace(/^t3_/, ''),
    subreddit,
    replyAuthors: [ ...replies.map(({ author }) => ({ author: author.name })) ],
  }
}
