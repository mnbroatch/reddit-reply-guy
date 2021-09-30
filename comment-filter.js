const stripQuotes = require('./strip-quotes')

const MIN_COMMENT_LENGTH = +process.env.MIN_COMMENT_LENGTH 

const authorWhitelist = [
  'worldmobilemod',
  'WMTmod',
  'SaveVideo',
  'savevideobot',
  'Quoterm',
  'Lars_porsenna',
  'Jaysog',
  'CryptoFutureBot',
  '[deleted]',
  'pekofy_bot',
]

const subredditWhitelist = [
  'SpotaTroll',
  'AmITheDevil',
  'Genshin_Memepact',
  'FreeKarma4U',
  'Superstonk',
  '196',
  'RandomActsOfGaming',
  'steam_giveaway',
  'giveaways',
  'copypasta',
  'CelebAssPussyMouth',
  'pickoneceleb',
  'CelebEconoy',
  'CelebWouldYouRather',
]

const criteria = [
  {
    description: 'Is subreddit not the author\'s personal subreddit?',
    test: (comment) => comment.subreddit.display_name.toLowerCase() !== `u_${comment.author.name.toLowerCase()}`
  },
  {
    description: 'Is subreddit not whitelisted?',
    test: (comment) =>
      !subredditWhitelist
        .find(subreddit => subreddit.toLowerCase() === comment.subreddit.display_name.toLowerCase())
  },
  {
    description: 'Is author not whitelisted?',
    test: (comment) => !authorWhitelist.includes(comment.author.name),
  },
  {
    description: 'Is body not primarily a reddit shorthand link?',
    test: (comment) => {
      // TODO: fix this; why first word?
      const firstWord = comment.body.split(' ')[0]
      return comment.body.length > firstWord.length * 2
        || !/^\/?[ur]\//.test(firstWord)
    },
  },
  {
    description: 'Is comment actually there?',
    test: (comment) => 
      comment.body !== '[removed]'
      && comment.body !== '[deleted]'
  },
  {
    description: 'Is body long enough?',
    test: (comment) => comment.body.length > MIN_COMMENT_LENGTH,
  },
]

module.exports = function (comment) {
  return criteria.every(
    criterion => criterion.test(comment)
  )
}

