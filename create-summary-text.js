const subredditsThatDisallowLinks = [
  'pcmasterrace',
]

const subredditsThatDisallowUsernameLinks = [
  'politics',
]

function createReportText(commentPair) {
  return `Copies ${commentPair.original.permalink}`
}

function createReplyText (commentPair) {
  const subreddit = commentPair.original.subreddit.display_name
  const noLinks = subredditsThatDisallowLinks
    .find(sub => sub.toLowerCase() === subreddit.toLowerCase())
  const noUsernameLinks = noLinks || subredditsThatDisallowUsernameLinks
    .find(sub => sub.toLowerCase() === subreddit.toLowerCase())

  const original = noLinks
    ? 'another'
    : `[this one](http://np.${commentPair.original.permalink})`

  const originalLocation = commentPair.copy.link_id === commentPair.original.link_id
    ? 'elsewhere in this comment section.'
    : "in a duplicate post's comment section."

  const excuse = noLinks
    ? ' The rules of this subreddit do not allow me to link to it.'
    : '' 

  const additional = noLinks
    ? ''
    : ` with [this](http://np.${commentPair.additional[0].copy.permalink}) comment which copies [this one](http://np.${commentPair.additional[0].original.permalink})`

  const username = noUsernameLinks
    ? 'the user above'
    : ` [/u/${commentPair.copy.author.name}](https://np.reddit.com/u/${commentPair.copy.author.name}/)`

  return `This comment was copied from ${original} ${originalLocation}${excuse}

It is probably not a coincidence, because this user has done it before${additional}.

beep boop, I'm a bot -|:] It is this bot's opinion that ${username} should be banned for spamming. A human checks in on this bot sometimes, so please reply if I made a mistake. Contact reply-guy-bot if you have concerns.`
}

function createTable (commentPairs) {
  return `Original | Plagiarized\n-------- | -----------`
    + commentPairs.reduce((acc, commentPair) =>
      acc + `\n[${commentPair.original.id}](http://np.${commentPair.original.permalink}) | [${commentPair.copy.id}](http://np.${commentPair.copy.permalink})`
      , '')
}


module.exports = {
  createReplyText,
  createReportText,
  createTable,
}
