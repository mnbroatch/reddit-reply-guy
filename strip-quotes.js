// probably not robust enough
module.exports = function stripQuotes(comment) {
  return comment.split('\n')
    .filter(line => line.trim()[0] !== '>')
    .join(' ')
}

