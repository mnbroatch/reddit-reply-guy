const { MIN_PLAGIARIST_CASES_FOR_COMMENT } = require('./constants')

module.exports = function authorPlagiarismCasesFilter  (authorPlagiarismCases) {
  const isOnlyRepetitiveInOneSub = authorPlagiarismCases.every(plagiarismCase => plagiarismCase.copy.subreddit.display_name === authorPlagiarismCases[0].copy.subreddit.display_name)

  if (isOnlyRepetitiveInOneSub && authorPlagiarismCases.length >= MIN_PLAGIARIST_CASES_FOR_COMMENT) {
    console.log(`repetitive sub found: ${authorPlagiarismCases[0].copy.subreddit.display_name}`)
    console.log('authorPlagiarismCases[0].author', authorPlagiarismCases[0].author)
  }

  return !isOnlyRepetitiveInOneSub || authorPlagiarismCases.length < MIN_PLAGIARIST_CASES_FOR_COMMENT
}
