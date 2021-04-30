const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const adapter = new FileSync('db/db.json')
const db = low(adapter)

db
  .defaults({
    fubarComments: [],
    fubarPosts: [],
    authorCooldowns: [],
  })
  .write()

async function isCommentFubar ({ id }) {
  return !!await db.get('fubarComments')
    .find({ id })
    .value()
}

async function isPostFubar ({ id }) {
  return !!await db.get('fubarPosts')
    .find({ id })
    .value()
}

function getAuthorCooldown(name) {
  return db.get('authorCooldowns')
    .find({ name })
    .value()
}

async function addCommentToFubarList({ id }) {
  if (
    !await db.get('fubarComments')
      .find({ id })
      .value()
  ) {
    db.get('fubarComments')
      .push({ id, processedAt: Date.now() })
      .write()
  }
}

async function addPostToFubarList(id) {
  if (
    !await db.get('fubarPosts')
      .find({ id })
      .value()
  ) {
    db.get('fubarPosts')
      .push({ id, processedAt: Date.now() })
      .write()
  }
}

async function addOrUpdateAuthorCooldown(name, cooldownStart, cooldownEnd, copyCount) {
  if (
    !await db.get('authorCooldowns')
      .find({ name })
      .value()
  ) {
    db.get('authorCooldowns')
      .push({ name, cooldownStart, cooldownEnd, copyCount })
      .write()
  } else {
    db.get('authorCooldowns')
      .assign({ name, cooldownStart, cooldownEnd, copyCount })
      .write()
  }
}

// maybe change all to cooldown rather than fubar for simplification
async function cleanup() {
  await db.get('authorCooldowns')
    .remove(({ cooldownEnd }) => cooldownEnd < Date.now())
    .write()

  await db.get('fubarComments')
    .remove(({ processedAt }) => processedAt < Date.now() - 1000 * 60 * 60 * 24)
    .write()

  await db.get('fubarPosts')
    .remove(({ processedAt }) => processedAt < Date.now() - 1000 * 60 * 60 * 24)
    .write()
}

module.exports = {
  isCommentFubar,
  isPostFubar,
  getAuthorCooldown,
  addCommentToFubarList,
  addPostToFubarList,
  addOrUpdateAuthorCooldown,
  cleanup,
}
