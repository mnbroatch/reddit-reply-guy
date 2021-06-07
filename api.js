const axios = require('axios')
const JSONdb = require('simple-json-db');
const uniqBy = require('lodash/uniqBy')
const Snoowrap = require('snoowrap')
const cache = require('./cache')
const Post = require('./post')
const stripComment = require('./strip-comment')
const { asyncMap } = require('./async-array-helpers')

const db = new JSONdb('db/authors.json')

// var http = require('http-debug').http
// var https = require('http-debug').https
// http.debug = 1
// https.debug = 1

const INITIAL_POST_LIMIT = +process.env.INITIAL_POST_LIMIT 
const AUTHOR_POST_LIMIT = +process.env.AUTHOR_POST_LIMIT
const REPLY_BOT_USERS = JSON.parse(process.env.REPLY_BOT_USERS)

const {
  CLIENT_ID,
  CLIENT_SECRET,
  REDDIT_USER,
  REDDIT_PASS,
  USER_AGENT,
} = process.env
const snoowrap = new Snoowrap({
  userAgent: USER_AGENT,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  username: REDDIT_USER,
  password: REDDIT_PASS
})
snoowrap.config({
  continueAfterRatelimitError: true,
  requestDelay: 1000,
  // debug: true,
})

class Api {
  constructor() {
    ;[
      'getPost',
      'getAuthorComments',
      'getDuplicatePostIds',
    ].forEach((functionName) => {
      this[functionName] = cache.register(this[functionName], this)
    })

    // caching this would be too redundant for little benefit
    this.getSubredditPosts = this.getSubredditPosts.bind(this)
  }

  async getPost (postId) {
    try {
      const post = await snoowrap.getSubmission(postId)
      const unwrappedPost = {
        id: await post.id,
        comments: await post.comments,
        post_hint: await post.post_hint,
        domain: await post.domain,
        removed_by_category: await post.removed_by_category,
      }
      console.log(`retrieved post: ${postId}`)
      return new Post(unwrappedPost)
    } catch (e) {
      return null
    }
  }

  async getSubredditPosts (subreddit) {
    try {
      console.log(`getting posts from subreddit: ${subreddit}`)
      return asyncMap(
        await snoowrap.getHot(subreddit, { limit: INITIAL_POST_LIMIT }),
        post => this.getPost(post.id)
      )
    } catch (e) {
      console.log('e1', e)
      return []
    }
  }

  async getAuthorComments (author) {
    try {
      console.log(`getting comments from author: ${author}`)
      return await snoowrap.getUser(author).getComments({ limit: AUTHOR_POST_LIMIT })
        .map(stripComment)
    } catch (e) {
      console.log(`couldn't get comments by: ${author}`)
      return []
    }
  }

  async isCommentAlreadyRepliedTo(comment) {
    try {
      return comment.replyAuthors.some(
        author => REPLY_BOT_USERS.some(
          user => user.toLowerCase() === author.toLowerCase() 
        )
      ) || (await snoowrap.getComment(comment.id).expandReplies({ depth: 1 }).replies)
        .some(
          reply => REPLY_BOT_USERS.some(
            user => user.toLowerCase() === reply.author.name.toLowerCase() 
          )
        )
    } catch (e) {
      console.log(`couldn't get replies for comment: http://reddit.com${comment.permalink}`)
      return true
    }
  }

  async getDuplicatePostIds(post) {
    let duplicatePostIds = []
    if (canTryImageSearch(post)) {
      try {
        duplicatePostIds = (await axios.get(
          `https://api.repostsleuth.com/image?filter=true&url=https:%2F%2Fredd.it%2Fn9p6fa&postId=${post.id}&same_sub=false&filter_author=false&only_older=false&include_crossposts=true&meme_filter=false&target_match_percent=90&filter_dead_matches=false&target_days_old=0`
        ))
          .data.matches.map(match => match.post.post_id)
      } catch (e) { }
    }

    // We should see if it's worth always checking both places
    // If there are too many hits from the image search, use this.
    // An example would be chess gifs; lots of false positives
    if (!duplicatePostIds.length || duplicatePostIds.length > 20) {
      try {
        duplicatePostIds = await asyncMap(
          await snoowrap.oauthRequest({
            uri: '/api/info',
            method: 'get',
            qs: {
              url: await post.url,
            }
          }),
          dupeMeta => dupeMeta.id
        )
      } catch (e) { }
    }

    return uniqBy([ ...duplicatePostIds, post.id ])
  }

  async reportAuthor (author, message) {
    console.log(`reporting author (I think): ${author}`)
    try {
      await snoowrap.oauthRequest({
        uri: '/api/report_user',
        method: 'post',
        qs: {
          reason: message,
          user: author,
        }
      })

      const authorData = db.get(author) || {}
      await db.set(author, {
        ...authorData,
        reported: Date.now()
      })
    } catch (e) {
      console.log('e', e)
    }
  }

  async reportComment (comment, message) {
    console.log(`reporting comment: ${comment.id}`)
    try {
      await ({
        ...comment,
        _r: snoowrap,
        _post: Snoowrap.objects.ReplyableContent.prototype._post,
        report: Snoowrap.objects.ReplyableContent.prototype.report,
      })
        .report({ reason: message })
    } catch (e) {
      console.log('e', e)
    }
  }

  async replyToComment (comment, message) {
    console.log(`replying to comment: ${comment.id}`)
    try {
      return ({
        ...comment,
        _r: snoowrap,
        _post: Snoowrap.objects.ReplyableContent.prototype._post,
        reply: Snoowrap.objects.ReplyableContent.prototype.reply,
      }) 
        .reply(message)
    } catch (e) {
      console.log('e', e)
    }
  }

  setAuthorLastSearched (author, plagiarismCaseCount) {
    const authorData = db.get(author) || {}
    return db.set(author, {
      ...authorData,
      lastSearched: Date.now(),
      plagiarismCaseCount,
    })
  }

  async getAuthorLastSearched (author) {
    return (await db.get(author))?.lastSearched
  }

  async hasAuthorBeenReported (author) {
    return !!(await db.get(author))?.reported
  }
}

function canTryImageSearch(post) {
  return post.post_hint === 'image'
    && !post.domain.includes('imgur')
    && !post.removed_by_category
}

const api = new Api()

module.exports = api
