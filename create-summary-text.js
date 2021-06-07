const MIN_PLAGIARIST_CASES_FOR_REPORT = +process.env.MIN_PLAGIARIST_CASES_FOR_REPORT

const subredditsThatDisallowUsernameLinks = [
  'politics',
  'LoveForLandlords',
]

function createReportText(plagiarismCase) {
  return `Copies reddit.com/comments/${plagiarismCase.original.link_id}/foo/${plagiarismCase.original.id}`
}

function createReplyText (plagiarismCase) {
  const subreddit = plagiarismCase.copy.subreddit.display_name
  const noUsernameLinks = subredditsThatDisallowUsernameLinks
    .find(sub => sub.toLowerCase() === subreddit.toLowerCase())

  const originalLocation = plagiarismCase.copy.link_id === plagiarismCase.original.link_id
    ? 'elsewhere in this comment section.'
    : "in a similar post's comment section."

  const user = noUsernameLinks
    ? 'the user above'
    : ` [/u/${plagiarismCase.author}](https://np.reddit.com/u/${plagiarismCase.author}/)`

  return `The above comment was stolen from [this one](http://np.reddit.com${plagiarismCase.original.permalink}) ${originalLocation}

It is probably not a coincidence, because there are more instances by this user:

${createTable(plagiarismCase.additional)}

beep boop, I'm a bot -|:] It is this bot's opinion that ${user} should be banned for karma manipulation. Don't feel bad, they are probably a bot too.`
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
