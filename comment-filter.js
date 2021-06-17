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
]

const subredditWhitelist = [
  'SpotaTroll',
  'Genshin_Memepact',
  'FreeKarma4U',
  'Superstonk',
  '196',
  'RandomActsOfGaming',
  'steam_giveaway',
  'giveaways',
  'copypasta',
]

const criteria = [
  {
    description: 'Is subreddit not whitelisted?',
    test: (maybeCopy) =>
      !subredditWhitelist
        .find(subreddit => {
          if (!maybeCopy.subreddit) {
            console.log('maybeCopy', maybeCopy)
          }
          return subreddit.toLowerCase() === maybeCopy.subreddit.display_name.toLowerCase()
        })
  },
  {
    description: 'Is author not whitelisted?',
    test: (maybeCopy) =>
      !authorWhitelist.includes(maybeCopy.author.name),
  },
  {
    description: 'Is body not primarily a reddit shorthand link?',
    test: (maybeCopy) => {
      // TODO: fix this; why first word?
      const firstWord = maybeCopy.body.split(' ')[0]
      return maybeCopy.body.length > firstWord.length * 2
        || !/^\/?[ur]\//.test(firstWord)
    },
  },
  {
    description: 'Is comment actually there?',
    test: (maybeCopy) => 
      maybeCopy.body !== '[removed]'
      && maybeCopy.body !== '[deleted]'
  },
  {
    description: 'Is body long enough?',
    test: (maybeCopy) =>
      maybeCopy.body.length > MIN_COMMENT_LENGTH,
  },
]

module.exports = function (comment) {
  return criteria.every(
    criterion => criterion.test(comment)
  )
}

