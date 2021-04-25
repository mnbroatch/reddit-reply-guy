const subredditsThatDisallowLinks = [
  'pcmasterrace',
]

const subredditsThatDisallowUsernameLinks = [
  'politics',
]

function createReportText(plagiarismCase) {
  return `Copies ${plagiarismCase.original.permalink}`
}

function createReplyText (
  plagiarismCase,
  additionalCases,
) {
  const subreddit = plagiarismCase.original.subreddit.display_name
  const noLinks = subredditsThatDisallowLinks
    .find(sub => sub.toLowerCase() === subreddit.toLowerCase())
  const noUsernameLinks = noLinks || subredditsThatDisallowUsernameLinks
    .find(sub => sub.toLowerCase() === subreddit.toLowerCase())

  const original = noLinks
    ? 'another'
    : `[this one](${plagiarismCase.original.permalink})`

  const excuse = noLinks
    ? ' The rules of this subreddit do not allow me to link to it.'
    : '' 

  const additional = noLinks
    ? ''
   : ` with [this](${additionalCases[0].plagiarized.permalink}) comment which copies [this one](${additionalCases[0].original.permalink})`

  const username = noUsernameLinks
    ? 'the user above'
    : ` [/u/${plagiarismCase.plagiarized.author.name}](https://www.reddit.com/u/${plagiarismCase.plagiarized.author.name}/)`

  return `This comment was copied from ${original} elsewhere in this comment section.${excuse}

It is probably not a coincidence, because this user has done it before${additional}.

beep boop, I'm a bot -|:] It is this bot's opinion that ${username} should be banned for spamming. A human checks in on this bot sometimes, so please reply if I made a mistake. Contact reply-guy-bot if you have concerns.`
}

function createTable (additionalCases) {
  return `Original | Plagiarized\n-------- | -----------`
    + additionalCases.reduce((acc, plagiarismCase) =>
        acc + `\n[${plagiarismCase.original.permalink}](${plagiarismCase.original.permalink}) | [${plagiarismCase.plagiarized.permalink}](${plagiarismCase.plagiarized.permalink})`
      , '')
}


module.exports = {
  createReplyText,
  createReportText,
  createTable,
}
