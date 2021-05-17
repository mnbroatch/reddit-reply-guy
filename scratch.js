const compareTwoStrings = require('string-similarity').compareTwoStrings

console.log(
  compareTwoStrings(
`I am absolutely sobbing right now

No man’s spaghetti should have to die that way`,
`I’m absolutly sobbnig right now

No man’s spaghetti should’ve to die that way`
  )
)
