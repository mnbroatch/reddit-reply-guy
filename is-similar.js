const compareTwoStrings = require('string-similarity').compareTwoStrings
const stripQuotes = require('./strip-quotes')

module.exports = function isSimilar(str1, str2, threshold = .85) {
  return compareTwoStrings(stripQuotes(str1), stripQuotes(str2)) > threshold
}
