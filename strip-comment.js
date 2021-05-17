// Subject to breaking if assumptions about snoowrap internals become untrue
module.exports = function stripComment({
  id,
  name,
  body,
  created,
  author,
  permalink,
  link_id,
  subreddit,
  locked,
  replies = [],
  reply,
  report,
  _r,
  _post,
}) {
  return {
    id,
    name,
    body,
    created,
    author,
    permalink,
    link_id,
    subreddit,
    locked,
    replies: [ ...replies.map(({ author }) => ({ author: author.name })) ],
    reply,
    report,
    _r,
    _post,
  }
}
