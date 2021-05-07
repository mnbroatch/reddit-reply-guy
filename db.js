const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('db/db.json')
const db = low(adapter)
const { asyncMap } = require('./async-array-helpers')

db
  .defaults({
    commentCooldowns: [],
    authorCooldowns: [],
  })
  .write()

async function getCommentCooldown ({ id }) {
  return !!await db.get('commentCooldowns')
    .find({ id })
    .value()
}

function getAuthorCooldown({ name }) {
  return db.get('authorCooldowns')
    .find({ name })
    .value()
}

async function addOrUpdateAuthorCooldown({ name, cooldownStart, cooldownEnd, copyCount }) {
  if (
    await db.get('authorCooldowns')
      .find({ name })
      .value()
  ) {
    await db.get('authorCooldowns')
      .find({ name })
      .assign({ cooldownStart, cooldownEnd, copyCount })
      .write()
  } else {
    await db.get('authorCooldowns')
      .push({ name, cooldownStart, cooldownEnd, copyCount })
      .write()
  }
}

async function addOrUpdateCommentCooldown({ name, cooldownStart, cooldownEnd }) {
  if (
    await db.get('commentCooldowns')
      .find({ name })
      .value()
  ) {
    await db.get('commentCooldowns')
      .find({ name })
      .assign({ cooldownStart, cooldownEnd })
      .write()
  } else {
    await db.get('commentCooldowns')
      .push({ name, cooldownStart, cooldownEnd })
      .write()
  }
}

async function cleanup(maxCommentAge) {
  await asyncMap(
    [ 'authorCooldowns', 'commentCooldowns' ],
    async (commentType) => {
      await db.get(commentType)
        .remove(({ cooldownEnd }) => cooldownEnd < Date.now() - maxCommentAge)
        .write()
    }
  )
}

module.exports = {
  getAuthorCooldown,
  getCommentCooldown,
  addOrUpdateAuthorCooldown,
  addOrUpdateCommentCooldown,
  cleanup,
}
