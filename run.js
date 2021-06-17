require('dotenv').config()
const fs = require('fs')
const api = require('./api')
const Data = require('./data')
const uniqBy = require('lodash/uniqBy')
const groupBy = require('lodash/groupBy')
const findPlagiarismCases = require('./find-plagiarism-cases')
const plagiarismCaseFilter = require('./plagiarism-case-filter')
const {
  createReplyText,
  createReportText,
  createModmailText,
  createTable
} = require('./create-summary-text')
const {
  asyncMap,
  asyncMapSerial,
  asyncFilter,
} = require('./async-array-helpers')

const MIN_PLAGIARIST_CASES_FOR_COMMENT = +process.env.MIN_PLAGIARIST_CASES_FOR_COMMENT
const MIN_PLAGIARIST_CASES_FOR_REPORT = +process.env.MIN_PLAGIARIST_CASES_FOR_REPORT
const MAX_COMMENT_AGE = +process.env.MAX_COMMENT_AGE 
const MAX_REMAINDER_AUTHORS = +process.env.MAX_REMAINDER_AUTHORS

const subsThatDemandOneReportPerAuthor = [
  'funny',
]

const subsThatRequestModmail = [
  'movies',
]

const subredditsThatDisallowBots = [
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
]

async function run ({
  dryRun,
  printTable,
  author,
  authors = author ? [ author ] : [],
  subreddit,
  subreddits = subreddit ? [ subreddit ] : [],
  postId,
  postIds = postId ? [ postId ] : [],
  initialPlagiarismCases = []
}) {
  console.log('time: ', (new Date()).toLocaleTimeString())
  const data = new Data()

  authors.length && console.log(`searching authors: ${authors}`)
  subreddits.length && console.log(`searching subreddits: ${subreddits}`)
  postIds.length && console.log(`searching postIds: ${postIds}`)

  ;(await asyncMap(postIds, api.getPost))
    .flat()
    .filter(post => !whitelistedTitles.some(title => post.title.toLowerCase().includes(title.toLowerCase())))
    .forEach(data.setPost)

  ;(await asyncMap(subreddits, api.getSubredditPosts))
    .flat()
    .filter(post => !whitelistedTitles.some(title => post.title.toLowerCase().includes(title.toLowerCase())))
    .forEach(data.setPost)

  // ignore inactive authors
  const commentsPerAuthor = (await asyncMap(uniqBy(authors), api.getAuthorComments))
    .filter(authorComments => authorComments.length)
    .filter((authorComments) => {
      authorComments.sort((a, b) => b.created - a.created)
      const isActive = authorComments[0].created * 1000 > Date.now() - MAX_COMMENT_AGE
      if (!isActive) {
        console.log(`ignoring inactive author: ${authorComments[0].author.name}`)
      }
      return isActive
    })

  await asyncMap(
    Object.entries(groupBy(
      (commentsPerAuthor).flat(),
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
          )
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
              duplicatePostIds,
            })
          }
        }
      )
    }
  )

  const plagiarismCases = uniqBy([ ...initialPlagiarismCases, ...findPlagiarismCases(data.getAllPosts()) ], 'copy.id')
  console.log('plagiarismCases.length', plagiarismCases.length)

  const plagiarismCasesByAuthor = groupBy(plagiarismCases, 'author')
  const plagiarismCasesPerAuthor = Object.values(plagiarismCasesByAuthor)
    .map(authorPlagiarismCases => authorPlagiarismCases.map(plagiarismCase => ({
      ...plagiarismCase,
      additional: authorPlagiarismCases.filter(pc => pc!== plagiarismCase)
    })))
    
  if (printTable) {
    plagiarismCasesPerAuthor.forEach((authorPlagiarismCases) => {
      if (authorPlagiarismCases.length) {
        console.log('----------------------------------')
        console.log(authorPlagiarismCases[0].author)
        console.log(createTable(authorPlagiarismCases))
      }
    })
  }

  await asyncMap(
    plagiarismCasesPerAuthor
      .filter(authorPlagiarismCases => authorPlagiarismCases.length >= MIN_PLAGIARIST_CASES_FOR_COMMENT),
    async (authorPlagiarismCases) => {
      if (dryRun) return

      let reply // will be overwritten each case, but we only need one per author
      let comment
      await asyncMapSerial(
        await asyncFilter(authorPlagiarismCases, plagiarismCaseFilter),
        async (plagiarismCase) => {
          if (
            subsThatDemandOneReportPerAuthor.some(sub => plagiarismCase.copy.subreddit.display_name.toLowerCase() === sub.toLowerCase())
            && api.getAuthorReportedSubs(plagiarismCase.author).includes(plagiarismCase.copy.subreddit.display_name)
          ) return // this is why we use asyncMapSerial here

          await api.reportComment(plagiarismCase.copy, createReportText(plagiarismCase))

          if (shouldReply(plagiarismCase)) {
            reply = await api.replyToComment(plagiarismCase.copy, createReplyText(plagiarismCase))
            comment = plagiarismCase.copy
          }

          if (subsThatRequestModmail.some(sub => plagiarismCase.copy.subreddit.display_name.toLowerCase() === sub.toLowerCase())) {
            await api.sendModmail(
              plagiarismCase.copy.subreddit.display_name,
              `reply-guy-bot found a match: ${plagiarismCase.copy.id}`,
              createModmailText(plagiarismCase)
            )
          }
        }
      )

      if (
        reply
        && authorPlagiarismCases.length >= MIN_PLAGIARIST_CASES_FOR_REPORT
        && !await api.hasAuthorBeenReported(comment.author.name)
      ) {
        await api.reportAuthor(comment.author.name, `http://reddit.com/comments/${comment.link_id}/-|:]/${reply.id}`)
      }
    }
  )

  if (!dryRun) {
    await asyncMap(
      authors,
      author => api.setAuthorLastSearched(
        author,
        plagiarismCasesByAuthor[author]?.length
      )
    )
  }

  // Carry over some of the cases whose authors we haven't investigated fully.
  // Only carry over least recently searched authors and cases.
  const remainderPlagiarismCasesPerAuthor = plagiarismCasesPerAuthor
    .filter(authorPlagiarismCases => !authors.includes(authorPlagiarismCases[0].author))

  const remainderAuthorsLastSearched = await asyncMap(
    remainderPlagiarismCasesPerAuthor,
    async authorPlagiarismCases => ({
      author: authorPlagiarismCases[0].author,
      lastSearched: await api.getAuthorLastSearched(authorPlagiarismCases[0].author),
      latestCommentCreated: authorPlagiarismCases.sort((a, b) => b.copy.created - a.copy.created)[0].copy.created,
      plagiarismCasesCount: authorPlagiarismCases.length
    })
  )

  const authorsToReturn = uniqBy(
    remainderAuthorsLastSearched
      .sort((a, b) => 
        (a.lastSearched || 0) - (b.lastSearched || 0)
          || b.plagiarismCasesCount - a.plagiarismCasesCount
          || b.latestCommentCreated - b.latestCommentCreated
      )
      .map(plagiarismCase => plagiarismCase.author)
  ).slice(0, MAX_REMAINDER_AUTHORS)

  const plagiarismCasesToReturn = authorsToReturn.map(author => plagiarismCasesByAuthor[author]).flat()

  return {
    plagiarismCases: plagiarismCasesToReturn,
    authors: authorsToReturn,
  }
}

function shouldReply (plagiarismCase) {
  return !subredditsThatDisallowBots.some(
    subreddit => subreddit.toLowerCase() === plagiarismCase.copy.subreddit.display_name.toLowerCase()
  )
}

module.exports = run
