const api = require('./api')
const { asyncEvery } = require('./async-array-helpers')

const MAX_COMMENT_AGE = +process.env.MAX_COMMENT_AGE 

const criteria = [
  {
    description: 'Is comment not too old?',
    test: ({ copy }) => copy.created * 1000 > Date.now() - MAX_COMMENT_AGE
  },
  {
    description: 'Is the comment not already reported?',
    test: async ({ copy }) => {
      // remove isCommentAlreadyRepliedTo after jun 9
      let x = await api.hasCommentBeenReported(copy)
      if (x) {
        console.log(`ignoring responded-to comment: ${copy.permalink}`)
      }
      return !x && !await api.isCommentAlreadyRepliedTo(copy)
    }
  },
]

module.exports = function (plagiarismCase) {
  return asyncEvery(
    criteria,
    async criterion => criterion.test(plagiarismCase)
  )
}
