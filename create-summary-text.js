const MIN_PLAGIARIST_CASES_FOR_REPORT = +process.env.MIN_PLAGIARIST_CASES_FOR_REPORT

const subredditsThatDisallowUsernameLinks = [
  'politics',
  'LoveForLandlords',
]

function createReportText(plagiarismCase) {
  return `bot - copies reddit.com/comments/${plagiarismCase.original.link_id}/foo/${plagiarismCase.original.id}`
}

function createModmailText (plagiarismCase) {
  return `Plagiarized comment found: ${plagiarismCase.copy.permalink}

Original: ${plagiarismCase.original.permalink}

Additional evidence against plagiarist:

${createTable(plagiarismCase.additional)}`
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

It is probably not a coincidence; here is some more evidence against this user:

${createTable(plagiarismCase.additional)}

beep boop, I'm a bot -|:] It is this bot's opinion that ${user} should be banned for karma manipulation. Don't feel bad, they are probably a bot too.

Confused? Read the [FAQ](https://www.reddit.com/user/reply-guy-bot/comments/n9fpva/faq/) for info on how I work and why I exist.`
}

function createTable (plagiarismCases) {
  return `Plagiarized | Original\n-------- | -----------`
    + plagiarismCases.reduce((acc, plagiarismCase) =>
      acc + `\n[${truncate(plagiarismCase.copy.body)}](http://np.reddit.com${plagiarismCase.copy.permalink}) | [${truncate(plagiarismCase.original.body)}](http://np.reddit.com${plagiarismCase.original.permalink})`
      , '')
}

function truncate(body) {
  const escapedBody = body.replace(/[\]\n\|\\]/g, ' ')
  return escapedBody.length > 25
    ? escapedBody.slice(0, 25).trim() + '...'
    : escapedBody
}

module.exports = {
  createReplyText,
  createReportText,
  createModmailText,
  createTable,
}
