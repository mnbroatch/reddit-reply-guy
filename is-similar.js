const compareTwoStrings = require('string-similarity').compareTwoStrings
const stripQuotes = require('./strip-quotes')

const SIMILARITY_THRESHOLD = +process.env.SIMILARITY_THRESHOLD

module.exports = function isSimilar(str1, str2, threshold = SIMILARITY_THRESHOLD) {
  const str1WithoutQuotes = stripQuotes(str1)
  const str2WithoutQuotes = stripQuotes(str2)
  if (str1WithoutQuotes.length > 5) {
    str1 = str1WithoutQuotes
  }
  if (str2WithoutQuotes.length > 5) {
    str2 = str2WithoutQuotes
  }
  return compareTwoStrings(str1, str2) > threshold
}
