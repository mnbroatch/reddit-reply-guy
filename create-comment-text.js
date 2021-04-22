const subredditsThatDisallowLinks = [
  'pcmasterrace',
]

const subredditsThatDisallowUsernameLinks = [
  'politics',
]

function createCommentText (
  plagiarismCase,
  additionalCases,
  isReport,
) {
  const subreddit = plagiarismCase.original.subreddit.display_name.toLowerCase()
  const noLinks = !isReport && subredditsThatDisallowLinks
    .find(sub => sub.toLowerCase() === subreddit)
  const noUsernameLinks = !isReport && subredditsThatDisallowUsernameLinks
    .find(sub => sub.toLowerCase() === subreddit)

  const original = noLinks
    ? 'another'
    : `[this one](${plagiarismCase.original.permalink})`

  const plagiarized = isReport
    ? `[This comment](${plagiarismCase.plagiarized.permalink})`
    : 'This comment'

  const additional = noLinks
    ? '.'
   : ` with [this](${additionalCases[0].plagiarized.permalink}) comment which copies [this one](${additionalCases[0].original.permalink})`

  return `This comment was copied from ${original} elsewhere in this comment section.`
    + (noLinks
      ? ' The rules of this subreddit do not allow me to link to it.'
      : '')
    + (isReport
      ? `\n\nMore instances of plagiarism by /u/${plagiarismCase.plagiarized.author.name}:\n\n${createTable(additionalCases)}`
      : `\n\nIt is probably not a coincidence, because this user has done it before${additional}`)
    + "\n\nbeep boop, I'm a bot >:] It is this bot's opinion that"
    + (noUsernameLinks
      ? ' the user above'
      : ` [/u/${plagiarismCase.plagiarized.author.name}](https://www.reddit.com/u/${plagiarismCase.plagiarized.author.name}/)`)
    + ` should be banned for spamming. A human checks in on this bot sometimes, so please reply if I made a mistake. Contact reply-guy-bot if you have concerns.`
}

function createTable (additionalCases) {
  return `Original | Plagiarized\n-------- | -----------`
    + additionalCases.reduce((acc, plagiarismCase) =>
        acc + `\n${plagiarismCase.original.permalink} | ${plagiarismCase.plagiarized.permalink}`
      , '')
}

module.exports = createCommentText
