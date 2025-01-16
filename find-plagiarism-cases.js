const sortBy = require('lodash/sortBy')
const groupBy = require('lodash/groupBy')
const uniqBy = require('lodash/uniqBy')
const isSimilar = require('./is-similar')
const stripQuotes = require('./strip-quotes')
const commentPairFilter = require('./comment-pair-filter')
const groupCommentsBySimilarBody = require('./group-comments-by-similar-body')

module.exports = function findPlagiarismCases (posts) {
  console.log(`about to look for plagiarism cases in ${posts.length} posts`)
  
  const commentsPerPostWithDupes = Object.values(
    groupBy(
      posts,
      post => post.duplicatePostIds.sort()[0]
    )
  ) 
    .map(posts => posts.map(post => post.comments).flat())
    .filter(postComments => postComments.length > 1)

  const maybePlagiarismCases = commentsPerPostWithDupes.map((comments) => {
    const post = posts.find(p => p.id === comments[0]?.link_id)
    const commentsByBody = groupCommentsBySimilarBody(comments)

    // If there are more matches than that, could be memery.
    // If bots start double posting, bump this filter up.
    return Object.values(commentsByBody)
      .filter(similarComments => similarComments.length > 1 && similarComments.length < 4)
      .map((similarComments) => {
        const [ original, ...copies ] = sortBy(similarComments, 'created')
        return copies
          .filter(copy => commentPairFilter(copy, original, comments, post))
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

  console.log('123123', 123123)
  return maybePlagiarismCases
    .filter(plagiarismCase => !repetitiveComments.some(c => c.id.includes(plagiarismCase.copy.id)))
}

