const MIN_PLAGIARIST_CASES_FOR_REPORT = +process.env.MIN_PLAGIARIST_CASES_FOR_REPORT

const subredditsThatDisallowLinks = [
  'pcmasterrace',
  'chodi',
  'formuladank',
]

const subredditsThatDisallowUsernameLinks = [
  'politics',
]

function createReportText(plagiarismCase) {
  return `Copies reddit.com/comments/${plagiarismCase.original.link_id}/foo/${plagiarismCase.original.id}`
}

function createReplyText (plagiarismCase) {
  const subreddit = plagiarismCase.copy.subreddit.display_name
  const noLinks = subredditsThatDisallowLinks
    .find(sub => sub.toLowerCase() === subreddit.toLowerCase())
  const noUsernameLinks = noLinks || subredditsThatDisallowUsernameLinks
    .find(sub => sub.toLowerCase() === subreddit.toLowerCase())

  const original = noLinks
    ? 'another'
    : `[this one](http://np.reddit.com${plagiarismCase.original.permalink})`

  const originalLocation = plagiarismCase.copy.link_id === plagiarismCase.original.link_id
    ? 'elsewhere in this comment section.'
    : "in a similar post's comment section."

  const excuse = noLinks
    ? ' The rules of this subreddit do not allow me to link to it.'
    : '' 

  const additional = noLinks
    ? '.'
    : `:

${createTable(plagiarismCase.additional)}`

  const username = noUsernameLinks
    ? 'the user above'
    : ` [/u/${plagiarismCase.author}](https://np.reddit.com/u/${plagiarismCase.author}/)`

  return `The above comment was stolen from ${original} ${originalLocation}${excuse}

It is probably not a coincidence, because this user has done it before${additional}

beep boop, I'm a bot -|:] It is this bot's opinion that ${username} should be banned for spamming. A human checks in on this bot sometimes, so please reply if I made a mistake. Contact reply-guy-bot if you have concerns.`
}

function createTable (plagiarismCases) {
  return `Original | Plagiarized\n-------- | -----------`
    + plagiarismCases.reduce((acc, plagiarismCase) =>
      acc + `\n[${truncate(plagiarismCase.original.body)}](http://np.reddit.com${plagiarismCase.original.permalink}) | [${truncate(plagiarismCase.copy.body)}](http://np.reddit.com${plagiarismCase.copy.permalink})`
      , '')
}

function truncate(body) {
  const escapedBody = body.replace(/[\]\n\|\\]/g, ' ')
  return escapedBody.length > 30
    ? escapedBody.slice(0, 30) + '...'
    : escapedBody
}

module.exports = {
  createReplyText,
  createReportText,
  createTable,
}
