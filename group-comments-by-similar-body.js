const stripQuotes = require('./strip-quotes')
const isSimilar = require('./is-similar')

module.exports = function groupCommentsBySimilarBody (comments) {
  return comments.reduce((acc, comment) => {
    const strippedBody = stripQuotes(comment.body)
    const body = strippedBody.length > 5
      ? strippedBody
      : comment.body

    const maybeKey = Object.keys(acc).find(key => isSimilar(body, key))
    return maybeKey
      ? { ...acc, [maybeKey]: [ ...acc[maybeKey], comment ] }
      : { ...acc, [body]: [comment] }
  }, {})
}
