const sortBy = require('lodash/sortBy')
const groupBy = require('lodash/groupBy')
const uniqBy = require('lodash/uniqBy')
const isSimilar = require('./is-similar')
const commentFilter = require('./comment-filter')
const commentPairFilter = require('./comment-pair-filter')

module.exports = function findPlagiarismCases (posts) {
  const commentsPerPostWithDupes = Object.values(
    groupBy(
      posts,
      post => post.duplicatePostIds.sort()[0]
    )
  ) 
    .map(posts => posts.map(post => post.comments).flat())

  console.log(`searching ${commentsPerPostWithDupes.length} posts`)

  const maybePlagiarismCases = commentsPerPostWithDupes.map((comments) => {
    console.log(`looking for plagiarism in post: ${comments[0]?.link_id} (${comments.length} comments)`)
    const commentsByBody = groupCommentsBySimilarBody(comments.filter(commentFilter))
    // If there are more matches than that, could be memery.
    // If bots start double posting, bump this filter up.
    return Object.values(commentsByBody)
      .filter(similarComments => similarComments.length === 2)
      .map((similarComments) => {
        const [ original, ...copies ] = sortBy(similarComments, 'created')
        return copies
          .filter(copy => commentPairFilter(copy, original, comments))
          .map(copy => ({ copy, original, author: copy.author.name }))
      })
      .flat()
  })
  .flat()

  // All this to avoid dinging repetitive individuals
  const plagiarists = uniqBy(maybePlagiarismCases.map(plagiarismCase => plagiarismCase.author))
  const plagiaristsComments = posts
    .map(post => post.comments).flat()
    .filter(comment => plagiarists.includes(comment.author.name))
  const commentsByPlagiarist = groupBy(
    plagiaristsComments,
    'author.name'
  )
  const repetitiveComments = Object.values(commentsByPlagiarist)
    .map((plagiaristComments) => Object.values(groupCommentsBySimilarBody(plagiaristComments, .7))
      .filter(similarComments => similarComments.length > 1)
    ).flat().flat()

  return maybePlagiarismCases
    .filter(plagiarismCase => !repetitiveComments.some(c => c.id.includes(plagiarismCase.copy.id)))
}

function groupCommentsBySimilarBody (comments, threshold = .85) {
  return comments.reduce((acc, comment) => {
    const maybeKey = Object.keys(acc).find(body => isSimilar(comment.body, body, threshold))
    return maybeKey
      ? { ...acc, [maybeKey]: [ ...acc[maybeKey], comment ] }
      : { ...acc, [comment.body]: [comment] }
  }, {})
}

