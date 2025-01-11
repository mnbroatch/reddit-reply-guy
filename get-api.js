const {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} = require("@aws-sdk/client-s3");
const fs = require('fs')
const getEnv = require('./get-env')
const axios = require('axios')
const JSONdb = require('simple-json-db');
const uniqBy = require('lodash/uniqBy')
const Snoowrap = require('snoowrap')
const cache = require('./cache')
const Post = require('./post')
const stripComment = require('./strip-comment')
const { asyncMap } = require('./async-array-helpers')

const authorsDb = new JSONdb('db/authors.json')
const commentsDb = new JSONdb('db/comments.json')

class Api {
  async initialize () {
    this.env = await getEnv()
    this.env.INITIAL_POST_LIMIT = +this.env.INITIAL_POST_LIMIT 
    this.env.AUTHOR_POST_LIMIT = +this.env.AUTHOR_POST_LIMIT

    this.snoowrap = new Snoowrap({
      userAgent: this.env.USER_AGENT,
      clientId: this.env.CLIENT_ID,
      clientSecret: this.env.CLIENT_SECRET,
      username: this.env.REDDIT_USER,
      password: this.env.REDDIT_PASS
    })
    this.snoowrap.config({
      continueAfterRatelimitError: true,
      requestDelay: 1000,
      // debug: true,
    })

    this.s3Client = new S3Client({region: 'us-east-1',});
  }

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

  async getComment (id) {
    const comment = this.snoowrap.getComment(id)

    return {
      id: await comment.id,
      name: await comment.name,
      body: await comment.body,
      created: await comment.created,
      author: await comment.author,
      permalink: await comment.permalink,
      link_id: (await comment.link_id).replace(/^t3_/, ''),
      parent_id: (await comment.parent_id).replace(/^t3_/, ''),
      subreddit: await comment.subreddit,
      replyAuthors: [ ...(await comment.replies).map(({ author }) => ({ author: author.name })) ],
    }
  }

  async getPost (postId) {
    try {
      const post = await this.snoowrap.getSubmission(postId)
      const unwrappedPost = {
        id: await post.id,
        comments: await post.comments,
        post_hint: await post.post_hint,
        domain: await post.domain,
        removed_by_category: await post.removed_by_category,
        title: await post.title,
        selftext: await post.selftext,
      }
      return new Post(unwrappedPost)
    } catch (e) {
      return null
    }
  }

  async getSubredditPosts (subreddit) {
    try {
      console.log('this.env.INITIAL_POST_LIMIT ', this.env.INITIAL_POST_LIMIT )
      return asyncMap(
        await this.snoowrap.getHot(subreddit, { limit: this.env.INITIAL_POST_LIMIT }),
        post => this.getPost(post.id)
      )
    } catch (e) {
      console.error(e)
      return []
    }
  }

  async getAuthorComments (author) {
    try {
      return await this.snoowrap.getUser(author).getComments({ limit: this.env.AUTHOR_POST_LIMIT })
        .map(stripComment)
    } catch (e) {
      return []
    }
  }

  async getDuplicatePostIds(post) {
    let duplicatePostIdsFromImageSearch = []
    let duplicatePostIdsFromUrlSearch = []
    let duplicatePostIdsFromReddit = []

    try {
      duplicatePostIdsFromReddit = await asyncMap(
        await this.snoowrap.getSubmission(post.id).getDuplicates().comments,
        dupeMeta => dupeMeta.id
      )
    } catch (e) {
      console.error(e)
    }

    try {
      duplicatePostIdsFromUrlSearch = await asyncMap(
        await this.snoowrap.oauthRequest({
          uri: '/api/info',
          method: 'get',
          qs: {
            url: await post.url,
          }
        }),
        dupeMeta => dupeMeta.id
      )
    } catch (e) {
      console.error(e)
    }

    if (canTryImageSearch(post)) {
      try {
        // Regular timeout parameter doesn't work if internet is down or other things:
        // https://stackoverflow.com/questions/36690451/timeout-feature-in-the-axios-library-is-not-working
        const source = axios.CancelToken.source()
        const timeout = setTimeout(() => {
          source.cancel()
        }, 1000 * 60 * 2)

        const matches = (await axios.get(
          `https://api.repostsleuth.com/image?filter=true&url=https:%2F%2Fredd.it%2Fn9p6fa&postId=${post.id}&same_sub=false&filter_author=false&only_older=false&include_crossposts=true&meme_filter=false&target_match_percent=90&filter_dead_matches=false&target_days_old=0`,
          { cancelToken: source.token }
          // { timeout: 1000 * 60 * 2 }
        )).data.matches.map(match => match.post.post_id)

        clearTimeout(timeout)

        // If there are too many hits from the image search,
        // we won't trust them. Perhaps a subtle meme format.
        // An example would be chess gifs; lots of false positives.
        duplicatePostIdsFromImageSearch = matches.length < 20
          ? matches
          : []
      } catch (e) {
        // fails often enough not to care if it does
      }
    }

    return uniqBy([ 
      ...duplicatePostIdsFromUrlSearch,
      ...duplicatePostIdsFromReddit,
      ...duplicatePostIdsFromImageSearch,
      post.id
    ])
  }


  async reportAuthor (author, message) {
    console.log(`reporting author (I think): ${author}`)
    try {
      await this.snoowrap.oauthRequest({
        uri: '/api/report_user',
        method: 'post',
        qs: {
          reason: message,
          user: author,
        }
      })

      const authorData = authorsDb.get(author) || {}
      await authorsDb.set(author, {
        ...authorData,
        reported: Date.now()
      })
    } catch (e) {
      console.error(e)
    }
  }

  async reportComment (comment, message) {
    console.log(`reporting comment: ${comment.id}`)
    try {
      await ({
        ...comment,
        _r: this.snoowrap,
        _post: Snoowrap.objects.ReplyableContent.prototype._post,
        report: Snoowrap.objects.ReplyableContent.prototype.report,
      })
        .report({ reason: message })

      const commentData = commentsDb.get(comment) || {}
      await commentsDb.set(comment.id, {
        ...commentData,
        reported: Date.now()
      })

      const authorData = authorsDb.get(comment.author.name) || {}
      const reportedInSubs = authorData.reportedInSubs || []
      await authorsDb.set(comment.author.name, {
        ...authorData,
        reportedInSubs: uniqBy([ ...reportedInSubs, comment.subreddit.display_name ]),
      })
    } catch (e) {
      console.log('e', e)
    }
  }

  async replyToComment (comment, message) {
    console.log(`replying to comment: ${comment.id} in ${comment.subreddit?.display_name }`)
    try {
      return ({
        ...comment,
        _r: this.snoowrap,
        _post: Snoowrap.objects.ReplyableContent.prototype._post,
        reply: Snoowrap.objects.ReplyableContent.prototype.reply,
      }) 
        .reply(message)
    } catch (e) {
      console.log('e', e)
    }
  }

  async sendModmail (subreddit, subject, text) {
    try {
    console.log(`sending modmail to r/${subreddit}`)
    await this.snoowrap.composeMessage({
      to: `r/${subreddit}`,
      subject,
      text,
    })
    } catch(e) {
      console.log('e', e)
    }
  }

  getAuthorReportedSubs (author) {
    return authorsDb.get(author)?.reportedInSubs || []
  }

  setAuthorLastSearched (author, plagiarismCaseCount) {
    const authorData = authorsDb.get(author) || {}
    return authorsDb.set(author, {
      ...authorData,
      lastSearched: Date.now(),
      plagiarismCaseCount,
    })
  }

  async getAuthorLastSearched (author) {
    return (await authorsDb.get(author))?.lastSearched
  }

  async hasCommentBeenReported (comment) {
    return !!(await commentsDb.get(comment.id))?.reported
  }

  async hasAuthorBeenReported (author) {
    return !!(await authorsDb.get(author))?.reported
  }

  async getSavestate () {
    if (this.env.IS_LOCAL) {
      try {
        return JSON.parse(fs.readFileSync('./db/savestate.json'))
        // savestate.authors = savestate.authors
        //   .concat([ // sneak in more authors here on startup
        //  ])
      } catch (e) {
        return {
          subreddit: subreddits[0],
          authors: [],
          plagiarismCases: [],
        }
      }
    } else {
      const response = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: 'redditreplyguy',
          Key: 'savestate',
        }),
      );
      return await response.Body.transformToString();
    }
  }

  writeSavestate (savestate) {
    if (this.env.IS_LOCAL) {
      fs.writeFileSync( './db/savestate.json', JSON.stringify(savestate))
    } else {
      const command = new PutObjectCommand({
        Bucket: 'redditreplyguy',
        Key: 'savestate',
        Body: JSON.stringify({
             subreddit: subreddits[0],
             authors: [],
             plagiarismCases: [],
        }),
      });

      return this.s3Client.send(command);
    }
  }
}

function canTryImageSearch(post) {
  return post.post_hint === 'image'
    && !post.domain.includes('imgur')
    && !post.removed_by_category
}

let api
async function getApi () {
  if (!api) {
    api = new Api()
    await api.initialize()
  }
  return api
}

module.exports = getApi
