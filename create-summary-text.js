const subredditsThatDisallowLinks = [
  'pcmasterrace',
]

const subredditsThatDisallowUsernameLinks = [
  'politics',
]

function createReportText(commentPair) {
  return `Copies ${commentPair.original.permalink}`
}

function createReplyText (
  commentPair,
  additionalCases,
) {
  const subreddit = commentPair.original.subreddit.display_name
  const noLinks = subredditsThatDisallowLinks
    .find(sub => sub.toLowerCase() === subreddit.toLowerCase())
  const noUsernameLinks = noLinks || subredditsThatDisallowUsernameLinks
    .find(sub => sub.toLowerCase() === subreddit.toLowerCase())

  const original = noLinks
    ? 'another'
    : `[this one](${commentPair.original.permalink})`

  const excuse = noLinks
    ? ' The rules of this subreddit do not allow me to link to it.'
    : '' 

  const additional = noLinks
    ? ''
   : ` with [this](${additionalCases[0].copy.permalink}) comment which copies [this one](${additionalCases[0].original.permalink})`

  const username = noUsernameLinks
    ? 'the user above'
    : ` [/u/${commentPair.copy.author.name}](https://www.reddit.com/u/${commentPair.copy.author.name}/)`

  return `This comment was copied from ${original} elsewhere in this comment section.${excuse}

It is probably not a coincidence, because this user has done it before${additional}.

beep boop, I'm a bot -|:] It is this bot's opinion that ${username} should be banned for spamming. A human checks in on this bot sometimes, so please reply if I made a mistake. Contact reply-guy-bot if you have concerns.`
}

function createTable (commentPairs) {
  return `Original | Plagiarized\n-------- | -----------`
    + commentPairs.reduce((acc, commentPair) =>
        acc + `\n[${commentPair.original.permalink}](${commentPair.original.permalink}) | [${commentPair.copy.permalink}](${commentPair.copy.permalink})`
      , '')
}


module.exports = {
  createReplyText,
  createReportText,
  createTable,
}
