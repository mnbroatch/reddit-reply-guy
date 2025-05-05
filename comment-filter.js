const stripQuotes = require('./strip-quotes')
const { MIN_COMMENT_LENGTH } = require('./constants')

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
  'FuturologyBot',
  'NanoraBot',
]

// generally subs with a lot of memes or rigid formats
const subredditWhitelist = [
  'CircuitsWordGame',
  'NYTStrands',
  'NYTConnections',
  'wordle',
  'u_randomdice_game',
  'suggestmeabook',
  'weirdspotifyplaylists',
  'musicsuggestions',
  '196',
  'National_Pet_Adoption',
  'rescuedogs',
  'AdoptableDogsTexas',
  'lebowski',
  'HIMYM',
  'howimetyourmother',
  'PrettyLittleLiars',
  'arresteddevelopment',
  'AmITheDevil',
  'AskOuija',
  'CelebAssPussyMouth',
  'CelebEconomy',
  'CelebWouldYouRather',
  'CopyPastas',
  'DeFreeKarma',
  'extrarfl',
  'FreeKarma4All',
  'FreeKarma4U',
  'FreeKarma4You',
  'FreeKarmaAll',
  'Genshin_Memepact',
  'GetFreeKarmaAnyTime',
  'KarmaFarming4Pros',
  'KarmaRoulette',
  'KarmaTricks',
  'NavySealCopypasta',
  'RandomActsOfGaming',
  'SpotaTroll',
  'Superstonk',
  'TITWcommentdump',
  'TITWleaderboard',
  'TranscribersOfReddit',
  'circlejerkcopypasta',
  'copypasta',
  'copypasta_es',
  'counting',
  'giveaways',
  'music_survivor',
  'pickoneceleb',
  'steam_giveaway',
  'wlzqnueg',
  'xxxKarma',
  'LoserleavesReddit',
  'ApsaraBazaar',
  'RandomActsofCards',
  'CelebAssPussyMouth2',
  'PornstarVSPornstar',
  'ChooseAPornstar',
  'boopthesnoot',
  'lastfm',
  'c4ctiktok',
  'buildit',
]

const bodyWhitelist = [
  'did i hear a rock and stone',
  'rock and stone',
  'sorry for your loss',
  'hahahahahahaha',
  'shut the fuck up donny',
  'shut the fuck up, donny',
  'why were they filming',
  'insists upon itself',
  'thank you for rescuing',
  'came here to say this',
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
    description: 'Is body not primarily a whitelisted phrase?',
    test: (comment) => {
      const matchingPhrase = bodyWhitelist.find(phrase => comment.body.toLowerCase().includes(phrase))
      return !matchingPhrase || comment.body.length > matchingPhrase.length * 2
    }
  },
  {
    description: 'Is body not a gif?',
    test: (comment) => !(/^!\[gif]\(.*\)$/.test(comment.body)),
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
      && comment.body !== '[ Removed by Reddit ]'
      && comment.body !== '[deleted]'
  },
  {
    description: 'Is body long enough?',
    test: (comment) => comment.body.length >= MIN_COMMENT_LENGTH
  },
]

module.exports = function (comment) {
  return criteria.every(
    criterion => criterion.test(comment)
  )
}

