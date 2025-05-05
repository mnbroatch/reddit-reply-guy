require('dotenv').config()
const getApi = require('./get-api')
const Data = require('./data')
const uniqBy = require('lodash/uniqBy')
const groupBy = require('lodash/groupBy')
const findPlagiarismCases = require('./find-plagiarism-cases')
const commentFilter = require('./comment-filter')
const plagiarismCaseFilter = require('./plagiarism-case-filter')
const authorPlagiarismCasesFilter = require('./author-plagiarism-cases-filter')
const {
  createReplyText,
  createReportText,
  createModmailText,
} = require('./create-summary-text')
const {
  asyncMap,
  asyncMapSerial,
  asyncFilter,
} = require('./async-array-helpers')
const {
  MIN_PLAGIARIST_CASES_FOR_REPORT,
  MAX_COMMENT_AGE,
  MAX_REMAINDER,
  MAX_AUTHORS_TO_SEARCH,
  MIN_PLAGIARIST_CASES_FOR_COMMENT,
} = require('./constants')

const subsThatDemandOneReportPerAuthor = [
  'funny',
]

const subsThatRequestModmail = [
  'movies',
  'Unexpected',
]

const subredditsThatDisallowBots = [
  'seinfeld',
  'ElectricForest',
  'BoneAppleTea',
  'AnimalCrossing',
  'MAAU',
  'upvote',
  'pcmasterrace',
  'chodi',
  'formuladank',
  'BlackClover',
  'Overwatch',
  'castlevania',
  'teenagers',
  'americandad',
  'WTF',
  'Jokes',
  'gifs',
  'books',
  'EarthPorn',
  'AskReddit',
  'holdmyredbull',
  'IAmA',
  'sports',
  'politics',
  'Minecraft',
  'gratefuldead',
  'ich_iel',
  'FairyTaleAsFuck',
  'askscience',
  'texas',
  'Republican',
  'OldPhotosInRealLife',
  'cars',
  'Israel',
  'Arkansas',
  'MakeMeSuffer',
  'barkour',
]

const whitelistedTitles = [
  'Game Winning Goal Challenge',
  'loser leaves reddit',
  'favorite',
  'compatibility',
  'ranking',
  'autocomplete',
]

const DRY_RUN = false

async function run ({
  subreddit,
  initialPlagiarismCases = []
}) {
  // this filtering is for clearing some cases if the rules change
  const filteredInitialPlagiarismCases = initialPlagiarismCases
    .filter(plagiarismCase => commentFilter(plagiarismCase.copy))
  const api = await getApi()
  const data = new Data()

  const authorsToSearch = await getAuthorsToSearch(filteredInitialPlagiarismCases, api)

  console.log('filteredInitialPlagiarismCases.length', filteredInitialPlagiarismCases.length)
  console.log(`searching authors: ${authorsToSearch.join(', ')}`)
  console.log(`searching subreddit: ${subreddit}`)

  ;(await asyncMap([subreddit], api.getSubredditPosts))
    .flat()
    .map(post => ({ ...post, comments: post.comments.filter(commentFilter) }))
    .filter(post => !whitelistedTitles.some(title => post.title.toLowerCase().includes(title.toLowerCase())))
    .forEach(data.setPost)

  const commentsPerAuthor = (await asyncMap(uniqBy(authorsToSearch), api.getAuthorComments))
    .map(authorComments => authorComments.filter(commentFilter))
    .filter((authorComments) => {
      authorComments.sort((a, b) => b.created - a.created)
      const isActive = authorComments.length && authorComments[0].created * 1000 > Date.now() - MAX_COMMENT_AGE
      return isActive
    })

  await asyncMap(
    Object.entries(groupBy(
      commentsPerAuthor.flat(),
      'link_id'
    )),
    async ([postId, comments]) => {
      const post = data.getPost(postId) || await api.getPost(postId)
      if (post && !whitelistedTitles.some(title => post.title.toLowerCase().includes(title.toLowerCase()))) {
        data.setPost({
          ...post,
          comments: uniqBy(
            [ ...post.comments, ...comments ],
            'id'
          ).filter(commentFilter)
        })
      }
    }
  )

  await asyncMap(
    data.getAllPosts(),
    async (post) => {
      const duplicatePostIds = await api.getDuplicatePostIds(post)
      data.setPost({
        ...post,
        duplicatePostIds,
      })
      await asyncMap(
        duplicatePostIds,
        async (dupeId) => {
          const dupe = data.getPost(dupeId) || await api.getPost(dupeId)
          if (dupe) {
            data.setPost({
              ...dupe,
              comments: dupe.comments.filter(commentFilter),
              duplicatePostIds,
            })
          }
        }
      )
    }
  )

  const plagiarismCases = await asyncFilter(uniqBy([ ...filteredInitialPlagiarismCases, ...findPlagiarismCases(data.getAllPosts()) ], 'copy.id'), plagiarismCaseFilter)

  const plagiarismCasesByAuthor = groupBy(plagiarismCases, 'author')
  const plagiarismCasesPerAuthor = Object.values(plagiarismCasesByAuthor).filter(authorPlagiarismCasesFilter)

  if (!DRY_RUN) {
    await asyncMap(
      plagiarismCasesPerAuthor.filter(authorPlagiarismCases => authorPlagiarismCases.length > MIN_PLAGIARIST_CASES_FOR_COMMENT),
      async (authorPlagiarismCases) => {
        let reply // will be overwritten each case, but we only need one per author
        let comment
        await asyncMapSerial(
          authorPlagiarismCases,
          async (plagiarismCase) => {
            if (
              subsThatDemandOneReportPerAuthor.some(sub => plagiarismCase.copy.subreddit.display_name.toLowerCase() === sub.toLowerCase())
              && api.getAuthorReportedSubs(plagiarismCase.author).includes(plagiarismCase.copy.subreddit.display_name)
            ) return // this is why we use asyncMapSerial here

            await api.reportComment(plagiarismCase.copy, createReportText(plagiarismCase))

            if (shouldReply(plagiarismCase)) {
              reply = await api.replyToComment(plagiarismCase.copy, createReplyText(plagiarismCase, authorPlagiarismCases))
              comment = plagiarismCase.copy
            }

            if (subsThatRequestModmail.some(sub => plagiarismCase.copy.subreddit.display_name.toLowerCase() === sub.toLowerCase())) {
              await api.sendModmail(
                plagiarismCase.copy.subreddit.display_name,
                `reply-guy-bot found a match: ${plagiarismCase.copy.id}`,
                createModmailText(plagiarismCase, authorPlagiarismCases)
              )
            }
          }
        )

        if (
          reply
          && authorPlagiarismCases.length >= MIN_PLAGIARIST_CASES_FOR_REPORT
          && !await api.hasAuthorBeenReported(comment.author.name)
        ) {
          await api.reportAuthor(comment.author.name, `http://reddit.com/comments/${comment.link_id}/${reply.id}`)
        }
      }
    )

    await asyncMap(
      authorsToSearch,
      author => api.setAuthorLastSearched(author)
    )
  }
  // if author is in authorsToSearch array, we just investigated them.
  const unsearchedPlagiarismCasesPerAuthor = plagiarismCasesPerAuthor
    .filter(authorPlagiarismCases => !authorsToSearch.includes(authorPlagiarismCases[0].author))

  return (await sortAuthorPlagiarismCases(unsearchedPlagiarismCasesPerAuthor, api))
    .flat()
    .slice(0, MAX_REMAINDER)
}

function shouldReply (plagiarismCase) {
  return !subredditsThatDisallowBots.some(
    subreddit => subreddit.toLowerCase() === plagiarismCase.copy.subreddit.display_name.toLowerCase()
  )
}

async function getAuthorsToSearch (plagiarismCases, api) {
  const plagiarismCasesPerAuthor = Object.values(groupBy(plagiarismCases, 'author'))
  return (await sortAuthorPlagiarismCases(plagiarismCasesPerAuthor, api))
    .map(authorPlagiarismCases => authorPlagiarismCases[0].author)
    .slice(0, MAX_AUTHORS_TO_SEARCH)
}

async function sortAuthorPlagiarismCases (plagiarismCasesPerAuthor, api) {
  const authorsMetadata = await asyncMap(
    plagiarismCasesPerAuthor,
    async authorPlagiarismCases => ({
      author: authorPlagiarismCases[0].author,
      lastSearched: await api.getAuthorLastSearched(authorPlagiarismCases[0].author),
      latestCommentCreated: authorPlagiarismCases.sort((a, b) => b.copy.created - a.copy.created)[0].copy.created,
      longestCommentLength: authorPlagiarismCases.reduce((acc, plagiarismCase) => Math.max(acc, plagiarismCase.copy.body.length), 0),
      plagiarismCasesCount: authorPlagiarismCases.length
    })
  )

  const sortedAuthorsMetadata = uniqBy(
    authorsMetadata
      .sort((a, b) => 
        (a.lastSearched || 0) - (b.lastSearched || 0)
          || b.plagiarismCasesCount - a.plagiarismCasesCount
          || b.longestCommentLength - a.longestCommentLength
          || b.latestCommentCreated - a.latestCommentCreated
      )
  )

  return plagiarismCasesPerAuthor.sort((a, b) => {
    return sortedAuthorsMetadata.findIndex(m => m.author === a[0].author) - sortedAuthorsMetadata.findIndex(m => m.author === b[0].author)
  })
}

module.exports = run
