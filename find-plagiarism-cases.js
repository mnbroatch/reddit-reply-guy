const sortBy = require('lodash/sortBy')
const groupBy = require('lodash/groupBy')
const uniqBy = require('lodash/uniqBy')
const isSimilar = require('./is-similar')
const stripQuotes = require('./strip-quotes')
const commentPairFilter = require('./comment-pair-filter')

module.exports = function findPlagiarismCases (posts) {
  const commentsPerPostWithDupes = Object.values(
    groupBy(
      posts,
      post => post.duplicatePostIds.sort()[0]
    )
  ) 
    .map(posts => posts.map(post => post.comments).flat())
    .filter(postComments => postComments.length > 1)

  console.log(`searching ${commentsPerPostWithDupes.length} posts`)
  console.log('posts.length', posts.length)

  const maybePlagiarismCases = commentsPerPostWithDupes.map((comments) => {
    console.log(`looking for plagiarism in post: ${comments[0]?.link_id} (${comments.length} comments)`)
    const commentsByBody = groupCommentsBySimilarBody(comments)
    Object.entries(commentsByBody).forEach(([body, comments]) => {
      if (body === '> Why does the mom look so conservative tho') {
        console.log('comments', comments)
      }
    })

    // If there are more matches than that, could be memery.
    // If bots start double posting, bump this filter up.
    return Object.values(commentsByBody)
      .filter(similarComments => similarComments.length > 1 && similarComments.length < 4)
      .map((similarComments) => {
        const [ original, ...copies ] = sortBy(similarComments, 'created')
        return copies
          .filter(copy => commentPairFilter(copy, original, comments))
          .map(copy => ({ copy, original, author: copy.author.name }))
      })
      .flat()
  })
  .flat()

  // All this to avoid dinging repetitive individuals who only post "nice cat", etc.
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

