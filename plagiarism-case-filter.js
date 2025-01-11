const getApi = require('./get-api')
const { asyncEvery } = require('./async-array-helpers')

const MAX_COMMENT_AGE = 259200000

const criteria = [
  {
    description: 'Is comment not too old?',
    test: ({ copy }) => copy.created * 1000 > Date.now() - MAX_COMMENT_AGE
  },
  {
    description: 'Is the comment not already reported?',
    test: async ({ copy }) => {
      const api = await getApi()
      if (await api.hasCommentBeenReported(copy)) {
        return false
      } else {
        return true
      }
    }
  },
]

module.exports = function (plagiarismCase) {
  return asyncEvery(
    criteria,
    async criterion => criterion.test(plagiarismCase)
  )
}
