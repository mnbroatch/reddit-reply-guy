const uniqBy = require('lodash/uniqBy')
const authorsMetadata = require("./authorsmetadata.json")

const sortedAuthorsMetadata = uniqBy(
  authorsMetadata
    .sort((a, b) => 
      (a.lastSearched || 0) - (b.lastSearched || 0)
        || b.plagiarismCasesCount - a.plagiarismCasesCount
        || b.longestCommentLength - a.longestCommentLength
        || b.latestCommentCreated - a.latestCommentCreated
    )
)

console.log('sortedAuthorsMetadata', sortedAuthorsMetadata)
