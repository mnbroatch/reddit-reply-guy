const stripQuotes = require('./strip-quotes')
const isSimilar = require('./is-similar')

module.exports = function groupCommentsBySimilarBody (comments, threshold = .85) {
  return comments.reduce((acc, comment) => {
    const strippedBody = stripQuotes(comment.body)
    const body = strippedBody.length > 5
      ? strippedBody
      : comment.body

    const maybeKey = Object.keys(acc).find(key => isSimilar(body, key, threshold))
    return maybeKey
      ? { ...acc, [maybeKey]: [ ...acc[maybeKey], comment ] }
      : { ...acc, [body]: [comment] }
  }, {})
}
